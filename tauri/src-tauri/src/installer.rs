//! Bundled dictionary installer - port of electron/services/dictionaryInstaller.ts
//! plus the dict install/uninstall IPC flows from main.ts. The zip is extracted
//! with the zip crate (no PowerShell dependency) and progress is streamed to the
//! requesting window exactly like the Electron events did.

use std::fs;
use std::io;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use zip::ZipArchive;

use crate::settings;
use crate::state;
use crate::AppState;

/// Locate the bundled dictionary.zip (packaged resource or dev checkout).
pub fn find_bundled_zip() -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(rd) = state::resource_dir() {
        candidates.push(rd.join("dictionary.zip"));
        candidates.push(rd.join("resources").join("dictionary.zip"));
    }
    // Dev fallback: the checkout copy next to this crate.
    candidates.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("dictionary.zip"));
    candidates.retain(|p| p.exists());
    candidates.into_iter().next().map(|p| p.to_string_lossy().to_string())
}

fn count_files(dir: &std::path::Path) -> usize {
    let mut n = 0;
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { n += count_files(&p); } else { n += 1; }
        }
    }
    n
}

fn remove_directory(dir: &std::path::Path) -> Result<usize, String> {
    if !dir.exists() { return Ok(0); }
    let count = count_files(dir);
    fs::remove_dir_all(dir).map_err(|e| format!("删除目录失败: {}", e))?;
    Ok(count)
}

#[tauri::command]
pub fn dict_can_install() -> Value {
    match find_bundled_zip() {
        Some(p) => json!({ "available": true, "zipPath": p }),
        None => json!({ "available": false, "zipPath": null }),
    }
}

#[tauri::command]
pub fn dict_install(window: WebviewWindow) -> Value {
    let zip_path = match find_bundled_zip() {
        Some(p) => p,
        None => {
            let _ = window.emit("dict:installError", json!({ "message": "未找到内置词库压缩包" }));
            return json!({ "started": false, "message": "未找到内置词库压缩包", "path": "", "count": 0 });
        }
    };
    let dest_dir = state::default_dictionary_dir();
    let dest_str = dest_dir.to_string_lossy().to_string();

    // Background extraction so the command resolves immediately; progress is
    // streamed via dict:installProgress / dict:installDone (Electron parity).
    std::thread::spawn(move || {
        if let Err(e) = run_install(&window, &zip_path, &dest_dir) {
            let _ = window.emit("dict:installError", json!({ "message": e }));
        }
    });

    json!({ "started": true, "message": "正在解压…", "path": dest_str })
}

/// Window-free extraction core so the flow can be unit-tested headlessly.
/// Reports (phase, count, total) progress through the callback.
pub(crate) fn extract_and_flatten(
    zip_path: &str,
    dest_dir: &std::path::Path,
    on_progress: &dyn Fn(&str, usize, usize),
) -> Result<(), String> {
    // Phase 1: clear destination and extract the zip with per-entry progress.
    if dest_dir.exists() {
        remove_directory(dest_dir)?;
    }
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    on_progress("extract", 0, 0);

    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let total = archive.len();
    for i in 0..total {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = entry.mangled_name(); // strips ../ traversal like the Electron extractor allowed
        let out_path = dest_dir.join(&name);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        if (i + 1) % 50 == 0 || i + 1 == total {
            on_progress("extract", i + 1, total);
        }
    }

    // Phase 2: flatten the dictionary/ top-level folder inside the zip.
    let inner = dest_dir.join("dictionary");
    if inner.is_dir() {
        let names: Vec<std::ffi::OsString> = fs::read_dir(&inner)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.file_name())
            .collect();
        let inner_total = names.len();
        for (i, name) in names.into_iter().enumerate() {
            fs::rename(inner.join(&name), dest_dir.join(&name)).map_err(|e| e.to_string())?;
            if i % 500 == 0 || i + 1 == inner_total {
                on_progress("move", i + 1, inner_total);
            }
        }
        let _ = fs::remove_dir(&inner);
    }
    Ok(())
}

pub(crate) fn run_install(window: &WebviewWindow, zip_path: &str, dest_dir: &std::path::Path) -> Result<(), String> {
    let emit = |phase: &str, count: usize, total: usize| {
        let _ = window.emit("dict:installProgress", json!({ "phase": phase, "count": count, "total": total }));
    };
    if let Err(e) = extract_and_flatten(zip_path, dest_dir, &emit) {
        return Err(e);
    }

    // Phase 3: point settings at the new directory and rebuild the index.
    let app: &AppHandle = window.app_handle();
    {
        let st = app.state::<AppState>();
        {
            let mut s = st.settings.lock().unwrap();
            s.dictionary_path = dest_dir.to_string_lossy().to_string();
            let _ = settings::save_settings(&s);
        }
        let mut dict = st.dict.lock().unwrap();
        dict.update_path(dest_dir.to_string_lossy().to_string());
        let file_count = fs::read_dir(dest_dir)
            .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".json")).count())
            .unwrap_or(0);
        let win2 = window.clone();
        let progress = move |count: usize| {
            let _ = win2.emit("dict:installProgress", json!({ "phase": "index", "count": count, "total": file_count }));
        };
        let progress_ref: &dyn Fn(usize) = &progress;
        dict.rebuild(Some(progress_ref));
        let status = dict.status();
        let count = status.get("count").and_then(|c| c.as_u64()).unwrap_or(0);
        let _ = window.emit("dict:installDone", json!({ "path": dest_dir.to_string_lossy(), "count": count }));
    }
    Ok(())
}

/// Remove the extracted dictionary directory and clear the saved path.
#[tauri::command]
pub fn dict_uninstall(app_state: State<'_, AppState>) -> Value {
    let dest = state::default_dictionary_dir();
    if !dest.exists() {
        return json!({ "success": true, "message": "词库目录不存在", "removed": 0 });
    }
    match remove_directory(&dest) {
        Ok(removed) => {
            {
                let mut s = app_state.settings.lock().unwrap();
                s.dictionary_path = String::new();
                let _ = settings::save_settings(&s);
            }
            app_state.dict.lock().unwrap().update_path(String::new());
            json!({ "success": true, "message": "词库已卸载", "removed": removed })
        }
        Err(e) => json!({ "success": false, "message": e, "removed": 0 }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Headless reproduction against the REAL bundled zip.
    #[test]
    fn extract_bundled_zip_flattens_to_temp() {
        let zip = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/dictionary.zip");
        assert!(std::path::Path::new(zip).exists(), "bundled zip missing: {}", zip);
        let dest = std::env::temp_dir().join("cdict-installer-test");
        let _ = fs::remove_dir_all(&dest);

        let started = std::time::Instant::now();
        let last = std::cell::Cell::<(usize, usize)>::default();
        extract_and_flatten(zip, &dest, &|_phase, c, t| { if t > 0 { last.set((c, t)); } })
            .expect("extract_and_flatten failed");

        let jsons = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
            .count();
        assert!(jsons > 20_000, "expected 20k+ json files at dest root, got {}", jsons);
        assert!(dest.join("aa.json").exists(), "aa.json missing");
        assert!(!dest.join("dictionary").exists(), "inner dictionary/ dir should be flattened away");
        assert_eq!(last.get().0, last.get().1, "progress never reached total");
        println!("extracted {} json files in {:?}", jsons, started.elapsed());
    }
}
