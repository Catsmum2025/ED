//! Word books (词书) - port of electron/services/wordbooks.ts (wordbooks.json).

use std::fs;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state;
use crate::AppState;

pub const DEFAULT_BOOK_ID: &str = "favorites";
pub const DEFAULT_BOOK_NAME: &str = "我的关注";
pub const BOOK_COVER_COUNT: i64 = 8;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BookWord {
    pub word: String,
    pub added_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WordBook {
    pub id: String,
    pub name: String,
    pub cover_index: i64,
    pub is_default: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub words: Vec<BookWord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordBookSummary {
    pub id: String,
    pub name: String,
    pub cover_index: i64,
    pub is_default: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub word_count: usize,
}

fn gen_id() -> String {
    format!("book_{}", uuid::Uuid::new_v4().simple())
}

fn normalize_cover_index(idx: serde_json::Value) -> i64 {
    let n = idx.as_f64().unwrap_or(0.0).floor();
    if n < 0.0 { 0 } else if n >= BOOK_COVER_COUNT as f64 { BOOK_COVER_COUNT - 1 } else { n as i64 }
}

fn make_default_book() -> WordBook {
    let now = now_ms();
    WordBook {
        id: DEFAULT_BOOK_ID.into(),
        name: DEFAULT_BOOK_NAME.into(),
        cover_index: 0,
        is_default: true,
        created_at: now,
        updated_at: now,
        words: vec![],
    }
}

pub struct WordBookService {
    books: Vec<WordBook>,
    loaded: bool,
}

impl WordBookService {
    pub fn new() -> Self {
        Self { books: Vec::new(), loaded: false }
    }

    fn load(&mut self) {
        if self.loaded { return; }
        self.loaded = true;
        let path = state::wordbooks_file();
        match fs::read_to_string(&path).ok().and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok()) {
            None => {
                self.books = vec![make_default_book()];
            }
            Some(arr) => {
                let mut books: Vec<WordBook> = arr.iter().map(|b| {
                    let id = b.get("id").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(gen_id);
                    let name = b.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| "未命名词书".into());
                    let words: Vec<BookWord> = b.get("words").and_then(|w| w.as_array()).map(|arr| {
                        arr.iter().filter_map(|w| {
                            let word = w.get("word").and_then(|x| x.as_str())?;
                            if word.is_empty() { return None; }
                            Some(BookWord {
                                word: word.to_string(),
                                added_at: w.get("addedAt").and_then(|a| a.as_u64()).unwrap_or_else(now_ms),
                            })
                        }).collect()
                    }).unwrap_or_default();
                    WordBook {
                        id,
                        name,
                        cover_index: normalize_cover_index(b.get("coverIndex").cloned().unwrap_or(serde_json::Value::Null)),
                        is_default: false,
                        created_at: b.get("createdAt").and_then(|v| v.as_u64()).unwrap_or_else(now_ms),
                        updated_at: b.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or_else(now_ms),
                        words,
                    }
                }).collect();
                // The default book must exist and stay first.
                if !books.iter().any(|b| b.id == DEFAULT_BOOK_ID) {
                    books.insert(0, make_default_book());
                }
                for b in &mut books {
                    if b.id == DEFAULT_BOOK_ID {
                        b.is_default = true;
                        b.name = DEFAULT_BOOK_NAME.into();
                    }
                }
                self.books = books;
            }
        }
        if !self.books.iter().any(|b| b.id == DEFAULT_BOOK_ID) {
            self.books.insert(0, make_default_book());
        }
        self.save();
    }

    fn save(&self) {
        let path = state::wordbooks_file();
        if let Some(dir) = std::path::Path::new(&path).parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.books) {
            let _ = fs::write(path, json);
        }
    }

    fn touch(&mut self, id: &str) {
        if let Some(b) = self.books.iter_mut().find(|b| b.id == id) {
            b.updated_at = now_ms();
        }
    }

    fn to_summary(b: &WordBook) -> WordBookSummary {
        WordBookSummary {
            id: b.id.clone(),
            name: b.name.clone(),
            cover_index: b.cover_index,
            is_default: b.is_default,
            created_at: b.created_at,
            updated_at: b.updated_at,
            word_count: b.words.len(),
        }
    }

    pub fn list(&mut self) -> Vec<WordBookSummary> {
        self.load();
        self.books.iter().map(Self::to_summary).collect()
    }

    pub fn get(&mut self, id: &str) -> Option<WordBook> {
        self.load();
        self.books.iter().find(|b| b.id == id).cloned()
    }

    pub fn create(&mut self, name: String, cover_index: serde_json::Value) -> WordBookSummary {
        self.load();
        let book = WordBook {
            id: gen_id(),
            name: { let t = name.trim().to_string(); if t.is_empty() { "未命名词书".into() } else { t } },
            cover_index: normalize_cover_index(cover_index),
            is_default: false,
            created_at: now_ms(),
            updated_at: now_ms(),
            words: vec![],
        };
        let summary = Self::to_summary(&book);
        self.books.push(book);
        self.save();
        summary
    }

    pub fn update(&mut self, id: &str, patch: serde_json::Value) -> Option<WordBookSummary> {
        self.load();
        let b = self.books.iter_mut().find(|b| b.id == id)?;
        if let Some(name) = patch.get("name").and_then(|v| v.as_str()) {
            if !b.is_default {
                let t = name.trim();
                if !t.is_empty() { b.name = t.to_string(); }
            }
        }
        if let Some(ci) = patch.get("coverIndex") {
            b.cover_index = normalize_cover_index(ci.clone());
        }
        let summary = Self::to_summary(b);
        self.touch(id);
        self.save();
        Some(summary)
    }

    pub fn delete(&mut self, id: &str) -> bool {
        self.load();
        let removable = self.books.iter().any(|b| b.id == id && !b.is_default);
        if !removable { return false; }
        self.books.retain(|b| b.id != id);
        self.save();
        true
    }

    pub fn add_word(&mut self, id: &str, word: &str) -> bool {
        self.load();
        let w = word.trim().to_string();
        if w.is_empty() { return false; }
        let b = match self.books.iter_mut().find(|b| b.id == id) { Some(b) => b, None => return false };
        if b.words.iter().any(|x| x.word == w) { return false; }
        b.words.push(BookWord { word: w, added_at: now_ms() });
        self.touch(id);
        self.save();
        true
    }

    pub fn remove_word(&mut self, id: &str, word: &str) -> bool {
        self.load();
        let b = match self.books.iter_mut().find(|b| b.id == id) { Some(b) => b, None => return false };
        let before = b.words.len();
        b.words.retain(|x| x.word != word);
        if b.words.len() == before { return false; }
        self.touch(id);
        self.save();
        true
    }

    pub fn toggle_favorite(&mut self, word: &str) -> bool {
        self.load();
        let w = word.trim().to_string();
        if w.is_empty() { return false; }
        let b = match self.books.iter_mut().find(|b| b.id == DEFAULT_BOOK_ID) { Some(b) => b, None => return false };
        match b.words.iter().position(|x| x.word == w) {
            Some(i) => { b.words.remove(i); self.touch(DEFAULT_BOOK_ID); self.save(); false }
            None => { b.words.push(BookWord { word: w, added_at: now_ms() }); self.touch(DEFAULT_BOOK_ID); self.save(); true }
        }
    }

    pub fn is_favorited(&mut self, word: &str) -> bool {
        self.load();
        let w = word.trim();
        self.books.iter().find(|b| b.id == DEFAULT_BOOK_ID)
            .map(|b| b.words.iter().any(|x| x.word == w))
            .unwrap_or(false)
    }

    pub fn books_containing_word(&mut self, word: &str) -> Vec<String> {
        self.load();
        let w = word.trim();
        self.books.iter()
            .filter(|b| b.words.iter().any(|x| x.word == w))
            .map(|b| b.id.clone())
            .collect()
    }
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn wordbooks_list(app_state: State<'_, AppState>) -> Vec<WordBookSummary> {
    app_state.books.lock().unwrap().list()
}
#[tauri::command]
pub fn wordbooks_get(app_state: State<'_, AppState>, id: String) -> Option<WordBook> {
    app_state.books.lock().unwrap().get(&id)
}
#[tauri::command]
pub fn wordbooks_create(app_state: State<'_, AppState>, name: String, cover_index: serde_json::Value) -> WordBookSummary {
    app_state.books.lock().unwrap().create(name, cover_index)
}
#[tauri::command]
pub fn wordbooks_update(app_state: State<'_, AppState>, id: String, patch: serde_json::Value) -> Option<WordBookSummary> {
    app_state.books.lock().unwrap().update(&id, patch)
}
#[tauri::command]
pub fn wordbooks_delete(app_state: State<'_, AppState>, id: String) -> bool {
    app_state.books.lock().unwrap().delete(&id)
}
#[tauri::command]
pub fn wordbooks_add_word(app_state: State<'_, AppState>, id: String, word: String) -> bool {
    app_state.books.lock().unwrap().add_word(&id, &word)
}
#[tauri::command]
pub fn wordbooks_remove_word(app_state: State<'_, AppState>, id: String, word: String) -> bool {
    app_state.books.lock().unwrap().remove_word(&id, &word)
}
#[tauri::command]
pub fn wordbooks_toggle_favorite(app_state: State<'_, AppState>, word: String) -> bool {
    app_state.books.lock().unwrap().toggle_favorite(&word)
}
#[tauri::command]
pub fn wordbooks_is_favorited(app_state: State<'_, AppState>, word: String) -> bool {
    app_state.books.lock().unwrap().is_favorited(&word)
}
#[tauri::command]
pub fn wordbooks_containing_word(app_state: State<'_, AppState>, word: String) -> Vec<String> {
    app_state.books.lock().unwrap().books_containing_word(&word)
}
