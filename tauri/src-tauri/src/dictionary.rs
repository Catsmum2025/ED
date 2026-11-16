//! Dictionary service - port of electron/services/dictionary.ts.
//! Scans a directory of per-word JSON files, builds a searchable index
//! (persisted to userData/index.json) and answers word lookups.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state;
use crate::AppState;

const INDEX_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DefEntry {
    #[serde(default)]
    pub pos: String,
    #[serde(default)]
    pub explanation_en: String,
    #[serde(default)]
    pub explanation_cn: String,
    #[serde(default)]
    pub example_en: String,
    #[serde(default)]
    pub example_cn: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Comparison {
    pub word_to_compare: String,
    pub analysis: String,
}

/// Exactly the shape of the per-word JSON files (field order included).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WordDefinition {
    pub word: String,
    #[serde(default)]
    pub pronunciation: String,
    #[serde(default)]
    pub concise_definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forms: Option<HashMap<String, String>>,
    #[serde(default)]
    pub definitions: Vec<DefEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison: Option<Vec<Comparison>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub word: String,
    pub file_name: String, // serialized as fileName
    #[serde(default)]
    pub concise: String,
    #[serde(default)]
    pub chinese_tokens: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryIndex {
    pub version: u32,
    pub dictionary_path: String,
    pub updated_at: u64,
    pub entries: Vec<IndexEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WordEntry {
    pub word: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concise: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{4e00}'..='\u{9fa5}')
}

pub struct DictionaryService {
    dictionary_path: String,
    index_path: PathBuf,
    index: Option<DictionaryIndex>,
}

impl DictionaryService {
    pub fn new(dictionary_path: String) -> Self {
        Self { dictionary_path, index_path: state::index_file(), index: None }
    }

    pub fn update_path(&mut self, new_path: String) {
        self.dictionary_path = new_path;
        self.index = None;
    }

    pub fn initialize(&mut self) {
        self.load_index();
        if self.index.is_none() {
            self.rebuild(None);
        }
    }

    pub fn status(&self) -> serde_json::Value {
        serde_json::json!({
            "exists": self.index.is_some(),
            "count": self.index.as_ref().map(|i| i.entries.len()).unwrap_or(0),
            "lastUpdated": self.index.as_ref().map(|i| i.updated_at).unwrap_or(0),
        })
    }

    fn load_index(&mut self) {
        let raw = match fs::read_to_string(&self.index_path) {
            Ok(r) => r,
            Err(_) => return,
        };
        match serde_json::from_str::<DictionaryIndex>(&raw) {
            Ok(parsed) => {
                if parsed.version == INDEX_VERSION && parsed.dictionary_path == self.dictionary_path {
                    self.index = Some(parsed);
                }
            }
            Err(_) => self.index = None,
        }
    }

    fn save_index(&self) {
        if let Some(idx) = &self.index {
            if let Ok(json) = serde_json::to_string(idx) {
                let _ = fs::write(&self.index_path, json);
            }
        }
    }

    /// Rebuild the search index. on_progress receives (files_indexed).
    pub fn rebuild(&mut self, on_progress: Option<&dyn Fn(usize)>) -> usize {
        let mut entries: Vec<IndexEntry> = Vec::new();
        if !self.dictionary_path.is_empty() && !std::path::Path::new(&self.dictionary_path).exists() {
            self.index = Some(DictionaryIndex {
                version: INDEX_VERSION,
                dictionary_path: self.dictionary_path.clone(),
                updated_at: now_ms(),
                entries,
            });
            self.save_index();
            if let Some(cb) = on_progress { cb(0); }
            return 0;
        }

        let mut files: Vec<String> = if self.dictionary_path.is_empty() {
            Vec::new()
        } else {
            fs::read_dir(&self.dictionary_path)
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .filter_map(|e| e.file_name().into_string().ok())
                        .filter(|n| n.ends_with(".json"))
                        .collect()
                })
                .unwrap_or_default()
        };
        files.sort();

        let total = files.len();
        for (i, file) in files.iter().enumerate() {
            let path = std::path::Path::new(&self.dictionary_path).join(file);
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<WordDefinition>(&raw) {
                    let chinese_tokens = extract_chinese_tokens(&data);
                    entries.push(IndexEntry {
                        word: data.word.clone(),
                        file_name: file.clone(),
                        concise: data.concise_definition.clone(),
                        chinese_tokens,
                    });
                }
            }
            if let Some(cb) = on_progress {
                if (i + 1) % 250 == 0 || i + 1 == total { cb(i + 1); }
            }
        }

        self.index = Some(DictionaryIndex {
            version: INDEX_VERSION,
            dictionary_path: self.dictionary_path.clone(),
            updated_at: now_ms(),
            entries,
        });
        self.save_index();
        self.index.as_ref().map(|i| i.entries.len()).unwrap_or(0)
    }

    pub fn get_word(&self, word: &str) -> Option<WordDefinition> {
        let entry = self
            .index
            .as_ref()?
            .entries
            .iter()
            .find(|e| e.word.to_lowercase() == word.to_lowercase())?;
        self.read_entry(entry)
    }

    fn read_entry(&self, entry: &IndexEntry) -> Option<WordDefinition> {
        let path = std::path::Path::new(&self.dictionary_path).join(&entry.file_name);
        let raw = fs::read_to_string(path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn get_words(&self, words: &[String]) -> Vec<Option<WordDefinition>> {
        let idx = match &self.index { Some(i) => i, None => return words.iter().map(|_| None).collect() };
        let mut map: HashMap<String, &IndexEntry> = HashMap::new();
        for e in &idx.entries { map.insert(e.word.to_lowercase(), e); }
        words
            .iter()
            .map(|w| map.get(&w.to_lowercase()).and_then(|e| self.read_entry(e)))
            .collect()
    }

    pub fn get_random_word(&self) -> Option<WordDefinition> {
        let idx = self.index.as_ref()?;
        if idx.entries.is_empty() { return None; }
        use rand::Rng;
        // Try a few times to find an entry with an example sentence (Electron parity).
        for _ in 0..12 {
            let i = rand::thread_rng().gen_range(0..idx.entries.len());
            if let Some(data) = self.read_entry(&idx.entries[i]) {
                if data.definitions.first().map(|d| !d.example_en.is_empty()).unwrap_or(false) {
                    return Some(data);
                }
            }
        }
        None
    }

    fn file_name_for(word: &str) -> String {
        let mut out = String::new();
        for c in word.chars() {
            if c.is_ascii_alphanumeric() { out.extend(c.to_lowercase()); }
            else { out.push('_'); }
        }
        let trimmed = out.trim_matches('_').to_string();
        format!("{}.json", if trimmed.is_empty() { "word".to_string() } else { trimmed })
    }

    pub fn add_word(&mut self, entry: &WordDefinition) -> WordDefinition {
        let file_name = Self::file_name_for(&entry.word);
        if !self.dictionary_path.is_empty() {
            let _ = fs::create_dir_all(&self.dictionary_path);
            let path = std::path::Path::new(&self.dictionary_path).join(&file_name);
            if let Ok(json) = serde_json::to_string_pretty(entry) {
                let _ = fs::write(path, json);
            }
        }
        if let Some(idx) = &mut self.index {
            let new_entry = IndexEntry {
                word: entry.word.clone(),
                file_name: file_name.clone(),
                concise: entry.concise_definition.clone(),
                chinese_tokens: extract_chinese_tokens(entry),
            };
            let pos = idx.entries.iter().position(|e| {
                e.file_name == file_name || e.word.to_lowercase() == entry.word.to_lowercase()
            });
            match pos {
                Some(i) => idx.entries[i] = new_entry,
                None => idx.entries.push(new_entry),
            }
        }
        self.save_index();
        entry.clone()
    }

    pub fn delete_word(&mut self, word: &str) -> bool {
        let idx = match &mut self.index { Some(i) => i, None => return false };
        let pos = idx.entries.iter().position(|e| e.word.to_lowercase() == word.to_lowercase());
        let pos = match pos { Some(p) => p, None => return false };
        let entry = idx.entries[pos].clone();
        let path = std::path::Path::new(&self.dictionary_path).join(&entry.file_name);
        let _ = fs::remove_file(path);
        idx.entries.remove(pos);
        self.save_index();
        true
    }

    pub fn search(&self, query: &str, lang: &str, limit: usize) -> Vec<WordEntry> {
        let idx = match &self.index { Some(i) => i, None => return vec![] };
        let q = query.trim().to_lowercase();
        if q.is_empty() { return vec![]; }

        let mut scored: Vec<(usize, &IndexEntry)> = Vec::new();
        if lang == "en" {
            for e in &idx.entries {
                let s = score_english(&e.word, &q);
                if s > 0 { scored.push((s, e)); }
            }
        } else {
            let mut qchars: Vec<char> = Vec::new();
            for c in q.chars().filter(|c| is_cjk(*c)) {
                if !qchars.contains(&c) { qchars.push(c); }
            }
            if qchars.is_empty() { return vec![]; }
            for e in &idx.entries {
                let text: String = if !e.chinese_tokens.is_empty() {
                    e.chinese_tokens.join("")
                } else {
                    e.concise.clone()
                };
                let chars: HashSet<char> = text.chars().collect();
                let mut score = 0usize;
                for c in &qchars { if chars.contains(c) { score += 1; } }
                if score > 0 { scored.push((score, e)); }
            }
        }

        if lang == "en" {
            scored.sort_by(|a, b| b.0.cmp(&a.0));
        } else {
            scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.word.chars().count().cmp(&b.1.word.chars().count())));
        }
        scored.into_iter().take(limit).map(|(_, e)| WordEntry {
            word: e.word.clone(),
            file_name: e.file_name.clone(),
            concise: Some(e.concise.clone()),
        }).collect()
    }
}

fn score_english(word: &str, query: &str) -> usize {
    let w = word.to_lowercase();
    if w == query { return 1000; }
    let len = w.chars().count();
    if w.starts_with(query) { return 500usize.saturating_sub(len); }
    if w.contains(query) { return 200usize.saturating_sub(len); }
    fuzzy_score(&w, query)
}

fn fuzzy_score(word: &str, query: &str) -> usize {
    let qchars: Vec<char> = query.chars().collect();
    let mut qi = 0usize;
    let mut score: isize = 0;
    let wlen = word.chars().count() as isize;
    for c in word.chars() {
        if qi < qchars.len() {
            if c == qchars[qi] { score += 10; qi += 1; }
        } else { break; }
    }
    if qi == qchars.len() {
        let s = score - wlen;
        if s > 0 { s as usize } else { 0 }
    } else { 0 }
}

fn extract_chinese_tokens(data: &WordDefinition) -> Vec<String> {
    let mut text = data.concise_definition.clone();
    for d in &data.definitions {
        text.push(' '); text.push_str(&d.explanation_cn); text.push(' '); text.push_str(&d.example_cn);
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let flush = |cur: &mut String, seen: &mut HashSet<String>, tokens: &mut Vec<String>| {
        if cur.chars().count() >= 2 && !seen.contains(cur) {
            seen.insert(cur.clone());
            tokens.push(cur.clone());
        }
        cur.clear();
    };
    for c in text.chars() {
        if is_cjk(c) { current.push(c); }
        else { flush(&mut current, &mut seen, &mut tokens); }
    }
    flush(&mut current, &mut seen, &mut tokens);
    tokens
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn dict_search(app_state: State<'_, AppState>, query: String, lang: String, limit: Option<usize>) -> Vec<WordEntry> {
    let d = app_state.dict.lock().unwrap();
    d.search(&query, &lang, limit.unwrap_or(20))
}

#[tauri::command]
pub fn dict_get_word(app_state: State<'_, AppState>, word: String) -> Option<WordDefinition> {
    app_state.dict.lock().unwrap().get_word(&word)
}

#[tauri::command]
pub fn dict_get_words(app_state: State<'_, AppState>, words: Vec<String>) -> Vec<Option<WordDefinition>> {
    let d = app_state.dict.lock().unwrap();
    d.get_words(&words)
}

#[tauri::command]
pub fn dict_rebuild_index(app_state: State<'_, AppState>) -> serde_json::Value {
    let mut d = app_state.dict.lock().unwrap();
    let count = d.rebuild(None);
    serde_json::json!({ "success": true, "count": count })
}

#[tauri::command]
pub fn dict_index_status(app_state: State<'_, AppState>) -> serde_json::Value {
    app_state.dict.lock().unwrap().status()
}

#[tauri::command]
pub fn dict_add_word(app_state: State<'_, AppState>, entry: WordDefinition) -> WordDefinition {
    let mut d = app_state.dict.lock().unwrap();
    d.add_word(&entry)
}

#[tauri::command]
pub fn dict_delete_word(app_state: State<'_, AppState>, word: String) -> bool {
    let mut d = app_state.dict.lock().unwrap();
    d.delete_word(&word)
}

#[tauri::command]
pub fn dict_random_word(app_state: State<'_, AppState>) -> Option<WordDefinition> {
    app_state.dict.lock().unwrap().get_random_word()
}
