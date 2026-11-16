//! Shared application state + process-wide path singletons.
//!
//! Electron kept its "main process" services as module-level singletons; the
//! Tauri port keeps them inside a single AppState managed by tauri so commands
//! can access them through State<_>.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::OnceLock;

use crate::dictionary::DictionaryService;
use crate::localmodel::LocalModel;
use crate::settings::AppSettings;
use crate::stats::StatsService;
use crate::wordbooks::WordBookService;

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub dict: Mutex<DictionaryService>,
    pub stats: Mutex<StatsService>,
    pub books: Mutex<WordBookService>,
    pub local_model: Mutex<LocalModel>,
}

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// %APPDATA%/com.ahpx.cdictionary - the Electron app's userData equivalent.
pub fn data_dir() -> &'static Path {
    DATA_DIR.get().expect("data dir initialised in setup")
}

pub fn set_data_dir(p: PathBuf) {
    let _ = DATA_DIR.set(p);
}

/// Directory where bundled resources (dictionary.zip, popup-icon.png) live.
pub fn resource_dir() -> Option<&'static Path> {
    RESOURCE_DIR.get().map(|p| p.as_path())
}

pub fn set_resource_dir(p: PathBuf) {
    let _ = RESOURCE_DIR.set(p);
}

/// File paths mirroring Electron's userData layout.
pub fn settings_file() -> PathBuf {
    data_dir().join("settings.json")
}
pub fn index_file() -> PathBuf {
    data_dir().join("index.json")
}
pub fn stats_file() -> PathBuf {
    data_dir().join("stats.json")
}
pub fn wordbooks_file() -> PathBuf {
    data_dir().join("wordbooks.json")
}
pub fn tts_cache_dir() -> PathBuf {
    let dir = data_dir().join("tts-cache");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
/// Where the bundled dictionary.zip is extracted to (Electron parity).
pub fn default_dictionary_dir() -> PathBuf {
    data_dir().join("dictionary")
}
