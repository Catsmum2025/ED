//! LLM service - port of electron/services/llm.ts.
//! Streaming translation (SSE), model listing, connection test and the
//! structured-output word generator.

use std::collections::HashMap;

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, State, WebviewWindow};

use crate::dictionary::{Comparison, DefEntry, WordDefinition};
use crate::AppState;

const WORD_GEN_PROMPT: &str = include_str!("word_gen_prompt.md");

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{4e00}'..='\u{9fa5}')
}

fn trim_base(u: &str) -> String {
    u.trim_end_matches('/').to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatePayload {
    pub text: String,
    pub model: String,
    #[serde(rename = "baseURL")]
    pub base_url: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub prefix_prompt: Option<String>,
}

/// Same system-prompt construction as the TS version: the dir placeholder is
/// replaced with the detected target language; a missing placeholder gets an
/// explicit target-language line appended.
fn build_system_content(text: &str, prefix_prompt: Option<&str>) -> String {
    let dir_text = if text.chars().any(is_cjk) { "英文" } else { "中文" };
    let raw_prefix = prefix_prompt.unwrap_or("").trim();
    if !raw_prefix.is_empty() {
        if raw_prefix.contains("{dir}") {
            raw_prefix.replace("{dir}", dir_text)
        } else {
            format!("{raw_prefix}\n目标语言：{dir_text}。仅输出译文，不要包含原文、说明或任何前缀。")
        }
    } else {
        format!("请将用户输入翻译为{dir_text}，仅输出译文，不要包含原文、说明或任何前缀。")
    }
}

fn auth(req: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
    if api_key.is_empty() { req } else { req.bearer_auth(api_key) }
}

#[tauri::command]
pub async fn translate_stream(window: WebviewWindow, payload: TranslatePayload) -> Result<(), String> {
    let url = format!("{}/chat/completions", trim_base(&payload.base_url));
    let system_content = build_system_content(&payload.text, payload.prefix_prompt.as_deref());
    let body = json!({
        "model": payload.model,
        "messages": [
            { "role": "system", "content": system_content },
            { "role": "user", "content": payload.text },
        ],
        "stream": true,
    });

    let send = async {
        let res = auth(reqwest::Client::new().post(&url).json(&body), &payload.api_key)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("请求失败 ({}): {}", status.as_u16(), text));
        }
        Ok::<_, String>(res)
    };

    let res = match send.await {
        Ok(r) => r,
        Err(msg) => {
            let _ = window.emit("translate:error", msg);
            return Ok(());
        }
    };

    let mut stream = res.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match stream.next().await {
            None => break,
            Some(Err(e)) => {
                let _ = window.emit("translate:error", format!("流中断: {e}"));
                return Ok(());
            }
            Some(Ok(chunk)) => {
                buf.extend_from_slice(&chunk);
                while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
                    let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&line_bytes);
                    let line = line.trim();
                    if line.is_empty() || !line.starts_with("data:") {
                        continue;
                    }
                    let data = line["data:".len()..].trim();
                    if data == "[DONE]" {
                        let _ = window.emit("translate:done", ());
                        return Ok(());
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                        if let Some(c) = v.pointer("/choices/0/delta/content").and_then(|c| c.as_str()) {
                            if !c.is_empty() {
                                let _ = window.emit("translate:chunk", c);
                            }
                        }
                    }
                }
            }
        }
    }
    let _ = window.emit("translate:done", ());
    Ok(())
}

#[tauri::command]
pub async fn llm_list_models(base_url: String, api_key: String) -> Vec<String> {
    let url = format!("{}/models", trim_base(&base_url));
    let res = auth(reqwest::Client::new().get(&url), &api_key).send().await;
    match res {
        Ok(r) if r.status().is_success() => {
            let v: Value = r.json().await.unwrap_or(Value::Null);
            v.get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default()
        }
        _ => vec![],
    }
}

#[tauri::command]
pub async fn llm_test_connection(base_url: String, api_key: String, model: String) -> Value {
    let url = format!("{}/chat/completions", trim_base(&base_url));
    let body = json!({
        "model": model,
        "messages": [{ "role": "user", "content": "hi" }],
        "max_tokens": 5,
    });
    let res = auth(reqwest::Client::new().post(&url).json(&body), &api_key)
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => json!({ "ok": true, "message": "连接成功" }),
        Ok(r) => {
            let status = r.status().as_u16();
            let text = r.text().await.unwrap_or_default();
            json!({ "ok": false, "message": format!("连接失败 ({}): {}", status, text) })
        }
        Err(e) => json!({ "ok": false, "message": format!("连接失败: {e}") }),
    }
}

// ── AI word generation (experimental feature) ────────────────────────────

fn word_gen_schema() -> Value {
    json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "word": { "type": "string", "minLength": 1 },
            "pronunciation": { "type": "string", "minLength": 1 },
            "concise_definition": { "type": "string", "minLength": 1 },
            "forms": {
                "type": "object",
                "propertyNames": { "type": "string" },
                "additionalProperties": { "type": "string" }
            },
            "definitions": {
                "minItems": 1,
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "pos": { "type": "string", "minLength": 1 },
                        "explanation_en": { "type": "string", "minLength": 1 },
                        "explanation_cn": { "type": "string", "minLength": 1 },
                        "example_en": { "type": "string", "minLength": 1 },
                        "example_cn": { "type": "string", "minLength": 1 }
                    },
                    "required": ["pos", "explanation_en", "explanation_cn", "example_en", "example_cn"],
                    "additionalProperties": false
                }
            },
            "comparison": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "word_to_compare": { "type": "string", "minLength": 1 },
                        "analysis": { "type": "string", "minLength": 1 }
                    },
                    "required": ["word_to_compare", "analysis"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["word", "pronunciation", "concise_definition", "forms", "definitions", "comparison"],
        "additionalProperties": false
    })
}

/// Markdown code fence marker, built from char escapes so this source file
/// never contains a literal backtick (which confuses some tooling).
fn fence() -> String {
    format!("{}{}{}", "\x60", "\x60", "\x60")
}

/// Find content inside a code fence without pulling in a regex crate.
fn fenced_content(text: &str) -> Option<String> {
    let f = fence();
    let open = text.find(&f)?;
    let after_open = &text[open + 3..];
    let nl = after_open.find('\n')?;
    let body_start = open + 3 + nl; // language tag on the fence line is dropped
    let rest = &text[body_start..];
    let close = rest.find(&f)?;
    Some(rest[..close].to_string())
}

/// Strip markdown fences and slice the outermost braces (Electron parity).
fn extract_json_object(text: &str) -> Result<Value, String> {
    let candidate = match fenced_content(text) {
        Some(c) => c,
        None => text.to_string(),
    };
    let start = candidate.find('{').ok_or("AI 未返回有效 JSON 对象")?;
    let end = candidate.rfind('}').ok_or("AI 未返回有效 JSON 对象")?;
    if end < start {
        return Err("AI 未返回有效 JSON 对象".into());
    }
    serde_json::from_str(&candidate[start..=end]).map_err(|e| format!("AI 返回格式无效: {e}"))
}

fn is_local_endpoint(base_url: &str) -> bool {
    let u = base_url.trim().to_ascii_lowercase();
    ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]
        .iter()
        .any(|host| u.contains(host))
}

fn shorten(text: &str, max: usize) -> String {
    let mut out: String = text.chars().take(max).collect();
    if text.chars().count() > max {
        out.push('…');
    }
    out
}

/// Map the model JSON onto a WordDefinition. Pulled out of the command so the
/// response-format fallback loop can reuse it.
fn word_definition_from_json(parsed: &Value, fallback_word: &str) -> Result<WordDefinition, String> {
    let defs_v = parsed.get("definitions").and_then(|d| d.as_array());
    let defs_v = match defs_v {
        Some(d) if !d.is_empty() => d,
        _ => return Err("AI 返回的释义为空或格式无效".into()),
    };

    let definitions: Vec<DefEntry> = defs_v
        .iter()
        .map(|d| DefEntry {
            pos: d.get("pos").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
            explanation_en: d.get("explanation_en").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
            explanation_cn: d.get("explanation_cn").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
            example_en: d.get("example_en").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
            example_cn: d.get("example_cn").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
        })
        .filter(|d| !d.explanation_en.is_empty() || !d.explanation_cn.is_empty())
        .collect();
    if definitions.is_empty() {
        return Err("AI 返回的释义为空或格式无效".into());
    }

    // Empty forms/comparison are omitted to stay consistent with hand-written entries.
    let forms: Option<HashMap<String, String>> = parsed
        .get("forms")
        .and_then(|f| f.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().filter(|s| !s.is_empty()).map(|s| (k.clone(), s.to_string())))
                .collect::<HashMap<String, String>>()
        })
        .filter(|m| !m.is_empty());

    let comparison: Option<Vec<Comparison>> = parsed
        .get("comparison")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .map(|item| Comparison {
                    word_to_compare: item.get("word_to_compare").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    analysis: item.get("analysis").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                })
                .filter(|c| !c.word_to_compare.is_empty())
                .collect::<Vec<Comparison>>()
        })
        .filter(|v| !v.is_empty());

    Ok(WordDefinition {
        word: parsed.get("word").and_then(|w| w.as_str()).filter(|w| !w.is_empty()).unwrap_or(fallback_word).to_string(),
        pronunciation: parsed.get("pronunciation").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        concise_definition: parsed.get("concise_definition").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        forms,
        definitions,
        comparison,
        ..Default::default()
    })
}

#[tauri::command]
pub async fn dict_generate_word(app_state: State<'_, AppState>, word: String) -> Result<WordDefinition, String> {
    let (base_url, api_key, model) = {
        let s = app_state.settings.lock().unwrap();
        (s.llm.base_url.clone(), s.llm.api_key.clone(), s.llm.model.clone())
    };
    if model.is_empty() || base_url.is_empty() {
        return Err("请先在设置中配置大语言模型 (设置 → 大语言模型)".into());
    }

    let url = format!("{}/chat/completions", trim_base(&base_url));
    let schema = word_gen_schema();
    // json_schema is the strictest and is understood by most OpenAI-compatible
    // servers (vLLM, llama.cpp, LM Studio, Unsloth Studio); some only take
    // json_object, and a few reject response_format altogether. Walk from
    // strict to loose, remembering the last error for the UI.
    let formats: [Option<Value>; 3] = [
        Some(json!({ "type": "json_schema", "json_schema": schema })),
        Some(json!({ "type": "json_object" })),
        None,
    ];

    let client = reqwest::Client::new();
    // Qwen-style thinking models burn most of their tokens on reasoning, and
    // the JSON is all we need. Only local servers get the extra field (the
    // hosted OpenAI API rejects unknown request fields); drop it again if the
    // server turns out not to accept it.
    let mut extras = is_local_endpoint(&base_url);
    let mut last_err = String::from("AI 未返回有效 JSON 对象");

    for format in formats.iter() {
        let mut body = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": WORD_GEN_PROMPT },
                { "role": "user", "content": word },
            ],
            "stream": false,
            "temperature": 0.1,
        });
        if let Some(f) = format {
            body["response_format"] = f.clone();
        }
        if extras {
            body["chat_template_kwargs"] = json!({ "enable_thinking": false });
        }

        let res = match auth(client.post(&url).json(&body), &api_key).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("请求失败: {e}")),
        };
        let status = res.status();
        let text = res.text().await.unwrap_or_default();

        if !status.is_success() {
            extras = false;
            last_err = format!("请求失败 ({}): {}", status.as_u16(), shorten(&text, 300));
            continue;
        }

        let data: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                last_err = format!("响应解析失败: {e}: {}", shorten(&text, 200));
                continue;
            }
        };
        let mut content = data
            .pointer("/choices/0/message/content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        if content.trim().is_empty() {
            // Thinking models sometimes leave content empty and put everything
            // into reasoning_content; try that before giving up.
            content = data
                .pointer("/choices/0/message/reasoning_content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
        }
        if content.trim().is_empty() {
            last_err = "AI 返回为空".into();
            continue;
        }

        match extract_json_object(&content) {
            Ok(parsed) => return word_definition_from_json(&parsed, &word),
            Err(e) => last_err = e,
        }
    }

    Err(last_err)
}
