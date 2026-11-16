//! TTS service - port of electron/services/tts.ts.
//! Talks to an IndexTTS-compatible OpenAI-style /v1/audio/speech endpoint and
//! caches results as <sha1>.wav under userData/tts-cache.

use std::fs;

use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use tauri::State;

use crate::state;
use crate::AppState;

fn trim_base(u: &str) -> String {
    u.trim_end_matches('/').to_string()
}

/// Serialize the rate like JS String(number): 1 -> "1", 1.5 -> "1.5".
fn rate_str(rate: f64) -> String {
    if rate.fract() == 0.0 { format!("{}", rate as i64) } else { format!("{}", rate) }
}

fn is_voice_id(v: &str) -> bool {
    let mut parts = v.split('_');
    match (parts.next(), parts.next(), parts.next()) {
        (Some("voice"), Some(rest), None) => !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()),
        _ => false,
    }
}

fn cache_key(text: &str, voice: &str, rate: f64) -> String {
    let mut hasher = Sha1::new();
    hasher.update(format!("{}|{}|{}", voice, rate_str(rate), text).as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

async fn synthesize(text: &str, voice: &str, base_url: &str, rate: f64) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() { return Err("文本为空".into()); }
    if base_url.is_empty() { return Err("未配置 TTS 服务地址".into()); }
    let url = format!("{}/v1/audio/speech", trim_base(base_url));

    // Only include the voice field if it looks like a real Voice ID - sending
    // an empty/legacy value (e.g. "default") triggers a 422 from the server.
    let mut form = reqwest::multipart::Form::new()
        .text("input", text.to_string())
        .text("response_format", "wav")
        .text("speed", rate_str(rate));
    if is_voice_id(voice) {
        form = form.text("voice", voice.to_string()).text("id", voice.to_string());
    }

    let res = reqwest::Client::new().post(&url).multipart(form).send().await
        .map_err(|e| format!("TTS 请求失败: {e}"))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("TTS 请求失败 ({}): {}", status, &err_text.chars().take(200).collect::<String>()));
    }
    Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

#[tauri::command]
pub async fn tts_synthesize(app_state: State<'_, AppState>, text: String) -> Result<Value, String> {
    let (enabled, engine, base_url, voice, rate) = {
        let s = app_state.settings.lock().unwrap();
        (s.audio.enabled, s.audio.engine.clone(), s.audio.base_url.clone(), s.audio.voice.clone(), s.audio.rate)
    };
    if !enabled { return Err("语音功能未启用".into()); }
    if engine != "indextts" { return Err("当前未使用 IndexTTS 引擎".into()); }

    let key = cache_key(&text, &voice, rate);
    let file_path = state::tts_cache_dir().join(format!("{}.wav", key));
    if file_path.exists() {
        return Ok(json!({ "path": file_path.to_string_lossy(), "cached": true }));
    }
    let bytes = synthesize(&text, &voice, &base_url, rate).await?;
    fs::write(&file_path, bytes).map_err(|e| e.to_string())?;
    Ok(json!({ "path": file_path.to_string_lossy(), "cached": false }))
}

#[tauri::command]
pub async fn tts_list_voices(app_state: State<'_, AppState>, base_url: Option<String>) -> Result<Vec<Value>, String> {
    let url_base = match &base_url { Some(b) if !b.is_empty() => b.clone(), _ => app_state.settings.lock().unwrap().audio.base_url.clone() };
    if url_base.is_empty() { return Ok(vec![]); }
    let url = format!("{}/v1/audio/voices", trim_base(&url_base));
    let res = reqwest::Client::new().get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("获取音色列表失败 ({})", res.status().as_u16()));
    }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default())
}

#[tauri::command]
pub async fn tts_check_health(app_state: State<'_, AppState>, base_url: Option<String>) -> Value {
    let url_base = match &base_url { Some(b) if !b.is_empty() => b.clone(), _ => app_state.settings.lock().unwrap().audio.base_url.clone() };
    if url_base.is_empty() {
        return json!({ "reachable": false, "modelLoaded": false, "message": "未配置地址" });
    }
    let url = format!("{}/v1/health", trim_base(&url_base));
    match reqwest::Client::new().get(&url).send().await {
        Err(e) => json!({ "reachable": false, "modelLoaded": false, "message": e.to_string() }),
        Ok(res) if !res.status().is_success() => {
            let status = res.status().as_u16();
            json!({ "reachable": false, "modelLoaded": false, "message": format!("服务返回 {}", status) })
        }
        Ok(res) => {
            let v: Value = res.json().await.unwrap_or(Value::Null);
            let loaded = v.get("model_loaded").and_then(|m| m.as_bool()).unwrap_or(false);
            json!({
                "reachable": true,
                "modelLoaded": loaded,
                "version": v.get("version"),
                "message": if loaded { "服务正常" } else { "服务已启动但模型未加载" },
            })
        }
    }
}
