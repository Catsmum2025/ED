//! Local model process manager - port of electron/services/localModel.ts.
//! Optionally launches a user-provided command (ollama serve, llama.cpp ...)
//! together with the app and tears it down on quit / settings change.

use std::process::{Child, Command, Stdio};

use serde_json::{json, Value};
use tauri::State;

use crate::settings::AppSettings;
use crate::AppState;

pub struct LocalModel {
    child: Option<Child>,
    running_command: String,
}

impl LocalModel {
    pub fn new() -> Self {
        Self { child: None, running_command: String::new() }
    }

    pub fn start(&mut self, command: &str) -> bool {
        let raw = command.trim().to_string();
        if raw.is_empty() { return false; }
        self.stop();

        #[cfg(windows)]
        let spawned = {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW so a console window never flashes behind the app.
            Command::new("cmd")
                .args(["/C", &raw])
                .stdin(Stdio::null())
                .creation_flags(0x0800_0000)
                .spawn()
        };
        #[cfg(not(windows))]
        let spawned = Command::new("sh").args(["-c", &raw]).stdin(Stdio::null()).spawn();

        match spawned {
            Ok(child) => {
                println!("[localModel] 已启动: {} (pid={})", raw, child.id());
                self.child = Some(child);
                self.running_command = raw;
                true
            }
            Err(e) => {
                eprintln!("[localModel] 启动失败: {}", e);
                self.child = None;
                self.running_command = String::new();
                false
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let pid = child.id();
            #[cfg(windows)]
            {
                // /T kills the whole descendant tree of the spawned shell.
                let _ = Command::new("taskkill")
                    .args(["/pid", &pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            #[cfg(not(windows))]
            {
                let _ = Command::new("kill").args(["-TERM", &format!("-{}", pid)]).status();
            }
            let _ = child.wait();
            println!("[localModel] 已停止 (pid={})", pid);
        }
        self.running_command = String::new();
    }

    pub fn is_running(&mut self) -> bool {
        match &mut self.child {
            Some(c) => match c.try_wait() {
                Ok(None) => true,
                _ => { self.child = None; false }
            },
            None => false,
        }
    }

    pub fn status(&mut self) -> Value {
        let running = self.is_running();
        let pid = self.child.as_ref().map(|c| c.id());
        json!({ "running": running, "pid": pid })
    }
}

/// The .bat startup script takes precedence over the raw command line.
pub fn effective_local_command(s: &AppSettings) -> String {
    let bat = s.llm.local_model_bat_path.trim();
    if !bat.is_empty() { return bat.to_string(); }
    s.llm.local_model_command.trim().to_string()
}

/// Restart the local model if the effective command changed (Electron parity).
pub fn sync_local_model(lm: &mut LocalModel, settings: &AppSettings) {
    let cmd = effective_local_command(settings);
    if cmd == lm.running_command {
        return; // unchanged
    }
    if cmd.is_empty() {
        lm.stop();
        return;
    }
    lm.start(&cmd);
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn llm_start_local_model(app_state: State<'_, AppState>, command: Option<String>) -> Value {
    let cmd = {
        let s = app_state.settings.lock().unwrap();
        command.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).unwrap_or_else(|| effective_local_command(&s))
    };
    if cmd.is_empty() {
        return json!({ "running": false, "pid": null, "message": "未配置启动命令或脚本" });
    }
    let mut lm = app_state.local_model.lock().unwrap();
    lm.start(&cmd);
    let mut status = lm.status();
    let msg = if status.get("running").and_then(|r| r.as_bool()).unwrap_or(false) { "已启动" } else { "启动失败" };
    status["message"] = json!(msg);
    status
}

#[tauri::command]
pub fn llm_stop_local_model(app_state: State<'_, AppState>) -> Value {
    let mut lm = app_state.local_model.lock().unwrap();
    lm.stop();
    lm.status()
}

#[tauri::command]
pub fn llm_local_model_status(app_state: State<'_, AppState>) -> Value {
    app_state.local_model.lock().unwrap().status()
}
