//! Bundled dictionary installer - port of electron/services/dictionaryInstaller.ts
//! plus the dict install/uninstall IPC flows from main.ts. The zip is extracted
//! with the zip crate (no PowerShell dependency) and progress is streamed to the
//! requesting window exactly like the Electron events did.

use std::fs;
use std::io::{BufRead, BufReader, Read};

use flate2::read::GzDecoder;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use zip::ZipArchive;

use crate::dictionary::{self, BuildEntry};
use crate::settings;
use crate::state;
use crate::AppState;

/// Bundled dictionary file names. The standard build ships the 25k
/// dictionary.zip; the full build replaces it with a solid ECDICT pack
/// (ecdict.jsonl.gz) so 770k entries do not pay per-file zip overhead.
const BUNDLED_NAMES: [&str; 3] = ["dictionary.zip", "dict_json.zip", "ecdict.jsonl.gz"];

/// Locate a bundled dictionary (packaged resource or dev checkout).
pub fn find_bundled_dictionary() -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(rd) = state::resource_dir() {
        for name in BUNDLED_NAMES {
            candidates.push(rd.join(name));
            candidates.push(rd.join("resources").join(name));
        }
    }
    // Dev fallback: the checkout copy next to this crate.
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    for name in BUNDLED_NAMES {
        candidates.push(dev.join(name));
    }
    candidates.retain(|p| p.exists());
    candidates.into_iter().next().map(|p| p.to_string_lossy().to_string())
}

fn is_jsonl_gz(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".gz")
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
    match find_bundled_dictionary() {
        Some(p) => json!({ "available": true, "zipPath": p }),
        None => json!({ "available": false, "zipPath": null }),
    }
}

#[tauri::command]
pub fn dict_install(window: WebviewWindow) -> Value {
    let zip_path = match find_bundled_dictionary() {
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

/// Import any dictionary zip chosen by the user (e.g. the 243 MB ECDICT
/// dict_json.zip). Same extraction + indexing pipeline as the bundled install.
#[tauri::command]
pub fn dict_import_zip(window: WebviewWindow, zip_path: String) -> Value {
    let path = std::path::PathBuf::from(&zip_path);
    if !path.is_file() {
        let _ = window.emit("dict:installError", json!({ "message": "压缩包不存在" }));
        return json!({ "started": false, "message": "压缩包不存在", "path": "", "count": 0 });
    }
    let dest_dir = state::default_dictionary_dir();
    let dest_str = dest_dir.to_string_lossy().to_string();
    std::thread::spawn(move || {
        if let Err(e) = run_install(&window, &zip_path, &dest_dir) {
            let _ = window.emit("dict:installError", json!({ "message": e }));
        }
    });
    json!({ "started": true, "message": "正在解压…", "path": dest_str })
}

/// If every file in the archive lives under the same top-level directory
/// (dictionary/ in the legacy zip, dict_json/ in the ECDICT zip), return it so
/// extraction can strip the prefix up front. Renaming 770k files afterwards
/// would take far longer than the extraction itself.
fn common_top_dir(archive: &ZipArchive<fs::File>) -> Option<String> {
    let mut prefix: Option<String> = None;
    let mut seen_file = false;
    for name in archive.file_names() {
        let normalized = name.replace('\\', "/");
        if normalized.ends_with('/') { continue; }
        seen_file = true;
        let mut parts = normalized.split('/');
        let first = parts.next()?;
        if first.is_empty() || parts.next().is_none() { return None; }
        match &prefix {
            None => prefix = Some(first.to_string()),
            Some(p) if p != first => return None,
            _ => {}
        }
    }
    if seen_file { prefix } else { None }
}

/// Legacy fallback for zips without a shared top directory that still wrap the
/// words in a single dict folder.
fn flatten_single_directory(
    dest_dir: &std::path::Path,
    on_progress: &dyn Fn(&str, usize, usize),
) -> Result<bool, String> {
    let dirs: Vec<std::path::PathBuf> = fs::read_dir(dest_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    if dirs.len() != 1 { return Ok(false); }
    let inner = &dirs[0];
    let names: Vec<std::path::PathBuf> = fs::read_dir(inner)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .collect();
    let total = names.len();
    for (i, path) in names.iter().enumerate() {
        let name = path.file_name().ok_or_else(|| "无效的文件名".to_string())?;
        fs::rename(path, dest_dir.join(name)).map_err(|e| e.to_string())?;
        if i % 500 == 0 || i + 1 == total {
            on_progress("move", i + 1, total);
        }
    }
    let _ = fs::remove_dir(inner);
    Ok(true)
}

/// Extract the zip and build index rows from the JSON bytes in the same pass.
/// Returns None when a single-dir flatten was applied (the collected file names
/// would no longer match the files on disk, so the caller rebuilds normally).
pub(crate) fn extract_and_build(
    zip_path: &str,
    dest_dir: &std::path::Path,
    on_progress: &dyn Fn(&str, usize, usize),
) -> Result<Option<Vec<BuildEntry>>, String> {
    // Clear destination and extract with per-entry progress.
    if dest_dir.exists() {
        remove_directory(dest_dir)?;
    }
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    on_progress("extract", 0, 0);

    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let prefix = common_top_dir(&archive);
    let total = archive.len();
    let mut rows: Vec<BuildEntry> = Vec::new();
    for i in 0..total {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        // mangled_name strips ../ traversal like the Electron extractor allowed.
        let raw = entry.mangled_name().to_string_lossy().replace('\\', "/");
        let rel = match prefix.as_deref() {
            Some(p) if raw.starts_with(p) && raw.as_bytes().get(p.len()) == Some(&b'/') => &raw[p.len() + 1..],
            _ => raw.as_str(),
        };
        if rel.is_empty() { continue; }
        let out_path = dest_dir.join(rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf: Vec<u8> = Vec::with_capacity(entry.size().min(1_000_000) as usize);
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
        if rel.ends_with(".json") {
            if let Ok(text) = std::str::from_utf8(&buf) {
                if let Some(row) = dictionary::build_entry_from_json(rel, text) {
                    rows.push(row);
                }
            }
        }
        // 770k entries: report at 500-file granularity to avoid flooding IPC.
        if (i + 1) % 500 == 0 || i + 1 == total {
            on_progress("extract", i + 1, total);
        }
    }

    let flattened = if prefix.is_none() {
        flatten_single_directory(dest_dir, on_progress)?
    } else {
        false
    };
    Ok(if flattened { None } else { Some(rows) })
}

/// Count JSONL records without materialising them, so the progress bar has a
/// real total while the import streams.
fn count_jsonl_records(path: &str) -> Result<usize, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let decoder = GzDecoder::new(BufReader::with_capacity(1 << 20, file));
    let mut reader = BufReader::with_capacity(1 << 20, decoder);
    let mut count = 0usize;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        count += buf[..read].iter().filter(|b| **b == b'\n').count();
    }
    Ok(count)
}

/// Import the full ECDICT pack: one JSON object per line, gzip-compressed.
/// Streams the file, writes one word JSON per record and builds the index
/// rows in the same pass. Solid compression keeps the shipped pack ~50 MB
/// instead of the ~300 MB a 770k-file zip needs.
pub(crate) fn import_jsonl_gz(
    gz_path: &str,
    dest_dir: &std::path::Path,
    on_progress: &dyn Fn(&str, usize, usize),
) -> Result<Vec<BuildEntry>, String> {
    if dest_dir.exists() {
        remove_directory(dest_dir)?;
    }
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;

    let total = count_jsonl_records(gz_path)?;
    on_progress("extract", 0, total);

    let file = fs::File::open(gz_path).map_err(|e| e.to_string())?;
    let decoder = GzDecoder::new(BufReader::with_capacity(1 << 20, file));
    let mut reader = BufReader::with_capacity(1 << 20, decoder);
    let mut rows: Vec<BuildEntry> = Vec::with_capacity(total);
    let mut line = String::new();
    let mut done = 0usize;
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let text = line.trim();
        if text.is_empty() { continue; }
        let Ok(data) = serde_json::from_str::<dictionary::WordDefinition>(text) else {
            // Skip a corrupt record instead of aborting a 770k import.
            continue;
        };
        let file_name = dictionary::json_file_name(&data.word);
        let row = dictionary::build_entry_from_data(data, &file_name);
        fs::write(dest_dir.join(&file_name), text.as_bytes())
            .map_err(|e| format!("写入词条 {} 失败: {e}", file_name))?;
        rows.push(row);
        done += 1;
        if done % 5000 == 0 {
            on_progress("extract", done, total);
        }
    }
    on_progress("extract", done, total);
    Ok(rows)
}

/// Window-free extraction core so the flow can be unit-tested headlessly.
#[cfg(test)]
pub(crate) fn extract_and_flatten(
    zip_path: &str,
    dest_dir: &std::path::Path,
    on_progress: &dyn Fn(&str, usize, usize),
) -> Result<(), String> {
    extract_and_build(zip_path, dest_dir, on_progress).map(|_| ())
}

pub(crate) fn run_install(window: &WebviewWindow, zip_path: &str, dest_dir: &std::path::Path) -> Result<(), String> {
    let emit = |phase: &str, count: usize, total: usize| {
        let _ = window.emit("dict:installProgress", json!({ "phase": phase, "count": count, "total": total }));
    };
    // Extract and parse in one pass: importing 770k JSONs only to read them
    // again for the index would double the install time. The full ECDICT pack
    // is a solid JSONL.GZ, which also yields index rows in the same pass.
    let rows = if is_jsonl_gz(zip_path) {
        Some(import_jsonl_gz(zip_path, dest_dir, &emit)?)
    } else {
        extract_and_build(zip_path, dest_dir, &emit)?
    };

    let app: &AppHandle = window.app_handle();
    let st = app.state::<AppState>();
    let path_str = dest_dir.to_string_lossy().to_string();
    {
        let mut s = st.settings.lock().unwrap();
        s.dictionary_path = path_str.clone();
        let _ = settings::save_settings(&s);
    }

    let mut dict = st.dict.lock().unwrap();
    dict.update_path(path_str.clone());
    let count = match rows {
        Some(rows) if !rows.is_empty() => {
            let total = rows.len();
            let idx = dictionary::finalize_index(&path_str, rows);
            let count = idx.count();
            dict.apply_index(idx);
            let _ = window.emit("dict:installProgress", json!({ "phase": "index", "count": total, "total": total }));
            count
        }
        _ => {
            // Zip without inline JSON rows (or a flattened legacy layout):
            // fall back to scanning the extracted files.
            let file_count = fs::read_dir(dest_dir)
                .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".json")).count())
                .unwrap_or(0);
            let win2 = window.clone();
            let progress = move |count: usize| {
                let _ = win2.emit("dict:installProgress", json!({ "phase": "index", "count": count, "total": file_count }));
            };
            let progress_ref: &dyn Fn(usize) = &progress;
            dict.rebuild(Some(progress_ref))
        }
    };
    let _ = window.emit("dict:installDone", json!({ "path": path_str, "count": count }));
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

    /// ECDICT zips wrap every file in dict_json/; extraction must strip that
    /// prefix instead of renaming 770k files afterwards.
    #[test]
    fn extracts_ecdict_zip_with_prefix_stripped() {
        use std::io::Write;
        let dir = std::env::temp_dir().join("edict-import-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("dict_json.zip");
        {
            let file = fs::File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            writer.start_file("dict_json/apple.json", opts).unwrap();
            writer.write_all(r#"{"word":"apple","translation":"n. 苹果"}"#.as_bytes()).unwrap();
            writer.start_file("dict_json/pretty.json", opts).unwrap();
            writer.write_all(r#"{"word":"pretty","translation":"adj. 漂亮的"}"#.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        let dest = dir.join("out");
        let last = std::cell::Cell::<(usize, usize)>::default();
        let rows = extract_and_build(zip_path.to_str().unwrap(), &dest, &|_phase, c, t| {
            if t > 0 { last.set((c, t)); }
        })
        .expect("extract ecdict zip")
        .expect("inline rows");
        assert!(dest.join("apple.json").exists(), "apple.json missing");
        assert!(dest.join("pretty.json").exists(), "pretty.json missing");
        assert!(!dest.join("dict_json").exists(), "prefix should be stripped");
        assert_eq!(last.get().0, last.get().1, "progress never reached total");

        // The import flow builds the index rows in the same pass.
        assert_eq!(rows.len(), 2);
        let index_path = dir.join("index.bin");
        let idx = dictionary::finalize_index(dest.to_str().unwrap(), rows);
        assert_eq!(idx.count(), 2);
        dictionary::write_index_for_test(&idx, &index_path);
        let svc = crate::dictionary::DictionaryService::new_for_test(
            dest.to_string_lossy().to_string(),
            index_path,
            idx,
        );
        let found = svc.search("苹果", "zh", 5);
        assert!(found.iter().any(|w| w.word == "apple"), "apple not found after import");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The full build ships a solid JSONL.GZ pack instead of a 770k-file zip.
    /// Import must stream it into per-word files and build index rows.
    #[test]
    fn imports_jsonl_gz_pack() {
        use std::io::Write;
        let dir = std::env::temp_dir().join("edict-jsonl-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let gz_path = dir.join("ecdict.jsonl.gz");
        {
            let file = fs::File::create(&gz_path).unwrap();
            let mut enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
            enc.write_all(r#"{"word":"apple","translation":"n. 苹果","concise_definition":"n. 苹果"}"#.as_bytes()).unwrap();
            enc.write_all(b"\n").unwrap();
            enc.write_all(r#"{"word":"pretty","translation":"adj. 漂亮的"}"#.as_bytes()).unwrap();
            enc.write_all(b"\n").unwrap();
            enc.finish().unwrap();
        }
        let dest = dir.join("out");
        let last = std::cell::Cell::<(usize, usize)>::default();
        let rows = import_jsonl_gz(gz_path.to_str().unwrap(), &dest, &|_phase, c, t| last.set((c, t)))
            .expect("import jsonl pack");
        assert_eq!(rows.len(), 2);
        assert!(dest.join("apple.json").exists(), "apple.json missing");
        assert!(dest.join("pretty.json").exists(), "pretty.json missing");
        assert_eq!(last.get(), (2, 2), "progress must reach the total");

        let index_path = dir.join("index.bin");
        let idx = dictionary::finalize_index(dest.to_str().unwrap(), rows);
        assert_eq!(idx.count(), 2);
        dictionary::write_index_for_test(&idx, &index_path);
        let svc = crate::dictionary::DictionaryService::new_for_test(
            dest.to_string_lossy().to_string(),
            index_path,
            idx,
        );
        assert!(svc.get_word("apple").is_some(), "apple not readable after pack import");
        let _ = fs::remove_dir_all(&dir);
    }
}
