//! Settings persistence - mirrors electron/utils/settings.ts.
//!
//! Difference vs Electron: the LLM apiKey is stored in plain text inside
//! settings.json (Electron used Chromium's safeStorage/DPAPI). Everything else
//! (file format, deep-merge semantics, legacy voice coercion) matches exactly.

use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state;

pub const DEFAULT_DICTIONARY_PATH: &str = "";
pub const DEFAULT_PREFIX_PROMPT: &str = "请将以下内容翻译为{dir}，仅输出译文，不要任何修饰或补充：";
pub const DEFAULT_VOICE: &str = "voice_28";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    #[serde(rename = "baseURL")]
    pub base_url: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub model: String,
    pub models: Vec<String>,
    pub prefix_prompt: String,
    pub local_model_command: String,
    pub local_model_bat_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub enabled: bool,
    pub engine: String,
    #[serde(rename = "baseURL")]
    pub base_url: String,
    pub voice: String,
    pub rate: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnkiSettings {
    pub enabled: bool,
    pub deck: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardSettings {
    pub global_shortcut: Option<String>,
    pub dict_hotkey: Option<String>,
    pub translate_hotkey: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettings {
    pub launch_at_login: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentalSettings {
    pub ai_word_generation: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    #[serde(rename = "accentColor")]
    pub accent_color: String,
    #[serde(rename = "customAccentColor")]
    pub custom_accent_color: String,
    pub language: String,
    #[serde(rename = "uiScale")]
    pub ui_scale: f64,
    /// Global animation intensity: "lively" | "calm" | "performance".
    pub motion: String,
    pub hide_scrollbar: bool,
    pub dictionary_path: String,
    pub llm: LlmSettings,
    pub audio: AudioSettings,
    pub anki: AnkiSettings,
    pub keyboard: KeyboardSettings,
    pub system: SystemSettings,
    pub experimental: ExperimentalSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            accent_color: "teal".into(),
            custom_accent_color: "#30524E".into(),
            language: "zh-CN".into(),
            ui_scale: 100.0,
            motion: "lively".into(),
            hide_scrollbar: true,
            dictionary_path: DEFAULT_DICTIONARY_PATH.into(),
            llm: LlmSettings {
                base_url: "http://127.0.0.1:8080/v1".into(),
                api_key: String::new(),
                model: String::new(),
                models: vec![],
                prefix_prompt: DEFAULT_PREFIX_PROMPT.into(),
                local_model_command: String::new(),
                local_model_bat_path: String::new(),
            },
            audio: AudioSettings {
                enabled: false,
                engine: "indextts".into(),
                base_url: "http://127.0.0.1:7866".into(),
                voice: DEFAULT_VOICE.into(),
                rate: 1.0,
            },
            anki: AnkiSettings { enabled: false, deck: "Default".into() },
            keyboard: KeyboardSettings {
                global_shortcut: None,
                dict_hotkey: None,
                translate_hotkey: None,
            },
            system: SystemSettings { launch_at_login: false },
            experimental: ExperimentalSettings { ai_word_generation: false },
        }
    }
}

/// Deep-merge patch over base (objects merge recursively, anything else
/// replaces) - same semantics the TS code got from object spread.
pub fn deep_merge(base: &Value, patch: &Value) -> Value {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            let mut out = b.clone();
            for (k, v) in p {
                let merged = match out.get(k) {
                    Some(prev) => deep_merge(prev, v),
                    None => v.clone(),
                };
                out.insert(k.clone(), merged);
            }
            Value::Object(out)
        }
        _ => patch.clone(),
    }
}

fn is_voice_id(v: &str) -> bool {
    let mut parts = v.split('_');
    match (parts.next(), parts.next(), parts.next()) {
        (Some("voice"), Some(rest), None) => {
            !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
        }
        _ => false,
    }
}

pub fn load_settings() -> AppSettings {
    let path = state::settings_file();
    let raw: Value = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let defaults = serde_json::to_value(AppSettings::default()).unwrap();
    let mut merged: AppSettings =
        serde_json::from_value(deep_merge(&defaults, &raw)).unwrap_or_default();
    if !is_voice_id(&merged.audio.voice) {
        merged.audio.voice = DEFAULT_VOICE.into();
    }
    merged
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = state::settings_file();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    // Antivirus / indexers can hold a brief exclusive lock on freshly written
    // JSON files (observed to silently eat the settings write around app exit),
    // so retry a few times before giving up.
    let mut last_err = String::new();
    for attempt in 0..5 {
        match fs::write(&path, &json) {
            Ok(()) => return Ok(()),
            Err(err) => {
                last_err = err.to_string();
                eprintln!("[save_settings] attempt {} failed: {}", attempt + 1, last_err);
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
        }
    }
    Err(last_err)
}

use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::AppState;

#[tauri::command]
pub fn settings_get(app_state: State<'_, AppState>) -> AppSettings {
    app_state.settings.lock().unwrap().clone()
}

/// Update settings and reproduce every side effect Electron's settings:set had:
/// dictionary re-point, local model restart, hotkey re-register, autostart.
#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    app_state: State<'_, AppState>,
    patch: Value,
) -> Result<AppSettings, String> {
    let (prev_dict_path, prev_llm_cmd, prev_llm_bat, prev_launch_at_login) = {
        let cur = app_state.settings.lock().unwrap();
        (
            cur.dictionary_path.clone(),
            cur.llm.local_model_command.clone(),
            cur.llm.local_model_bat_path.clone(),
            cur.system.launch_at_login,
        )
    };

    let current = serde_json::to_value(&*app_state.settings.lock().unwrap()).unwrap();
    let merged: AppSettings = serde_json::from_value(deep_merge(&current, &patch))
        .map_err(|e| format!("无效的设置补丁: {e}"))?;
    save_settings(&merged)?;

    // dictionaryPath changed -> re-point the dictionary service and rebuild the
    // index in the background. A 770k-entry ECDICT folder takes minutes; the
    // settings command must return immediately and commands answer empty while
    // indexing is in flight.
    if patch.get("dictionaryPath").is_some() && merged.dictionary_path != prev_dict_path {
        {
            let mut dict = app_state.dict.lock().unwrap();
            dict.update_path(merged.dictionary_path.clone());
        }
        let handle = app.clone();
        std::thread::spawn(move || {
            let st = handle.state::<AppState>();
            let mut dict = st.dict.lock().unwrap();
            dict.rebuild(None);
        });
    }

    // Local model command/bat changed -> restart it when necessary.
    if merged.llm.local_model_command != prev_llm_cmd
        || merged.llm.local_model_bat_path != prev_llm_bat
    {
        let mut lm = app_state.local_model.lock().unwrap();
        crate::localmodel::sync_local_model(&mut lm, &merged);
    }

    // Keyboard section present -> re-register global shortcuts.
    if patch.get("keyboard").is_some() {
        crate::windows::sync_hotkeys(&app, &merged.keyboard);
    }

    // Login-item toggle -> tell the OS.
    if merged.system.launch_at_login != prev_launch_at_login {
        let al = app.autolaunch();
        let _ = if merged.system.launch_at_login { al.enable() } else { al.disable() };
    }

    *app_state.settings.lock().unwrap() = merged.clone();
    Ok(merged)
}
