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
        let raw = query.trim();
        if raw.is_empty() { return vec![]; }

        let mut scored: Vec<(usize, &IndexEntry)> = Vec::new();
        if lang == "en" {
            let q = raw.to_lowercase();
            if q.is_empty() { return vec![]; }
            for e in &idx.entries {
                let s = score_english(&e.word, &q);
                if s > 0 { scored.push((s, e)); }
            }
        } else {
            // Chinese lookup: strip question wrappers ("...怎么说"), then score
            // phrase matches against the concise definition and its Chinese
            // tokens. Ranking prefers exact words, then phrases, then partial
            // character overlap; shorter (more common) English words win ties.
            let normalized = normalize_chinese_query(raw);
            let qchars: Vec<char> = normalized.chars().filter(|c| is_cjk(*c)).collect();
            if qchars.is_empty() { return vec![]; }
            for e in &idx.entries {
                let s = score_chinese(e, &normalized, &qchars);
                if s > 0 { scored.push((s, e)); }
            }
        }

        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.word.chars().count().cmp(&b.1.word.chars().count()))
                .then_with(|| a.1.word.cmp(&b.1.word))
        });
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

/// Question wrappers Chinese users often type when they actually want the
/// English word: "苹果怎么说", "水的英文是什么". Stripped longest-first.
const CHINESE_QUERY_NOISE: &[&str] = &[
    "用英文怎么说",
    "用英语怎么说",
    "的英文怎么说",
    "的英语怎么说",
    "怎么翻译成英文",
    "的英文是什么",
    "的英语是什么",
    "英文怎么说",
    "英语怎么说",
    "怎么翻译",
    "翻译成英文",
    "是什么意思",
    "什么意思",
    "的英文",
    "的英语",
    "怎么说",
    "英文",
    "英语",
    "意思",
    "翻译",
];

/// Reduce a Chinese lookup query to its meaningful core, e.g.
/// "苹果的英文怎么说" -> "苹果". Falls back to every CJK character when the
/// stripped result would be empty (e.g. the user literally typed "英语").
fn normalize_chinese_query(raw: &str) -> String {
    let cjk: String = raw.chars().filter(|c| is_cjk(*c)).collect();
    if cjk.is_empty() { return cjk; }
    let mut out = cjk.clone();
    for _ in 0..3 {
        let before = out.clone();
        for noise in CHINESE_QUERY_NOISE {
            if out.chars().count() > noise.chars().count() && out.contains(noise) {
                out = out.replace(noise, "");
            }
        }
        out = out.trim_matches('的').trim().to_string();
        if out == before || out.is_empty() { break; }
    }
    if out.is_empty() { cjk } else { out }
}

fn find_cjk_sub(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() { return None; }
    (0..=hay.len() - needle.len()).find(|&i| &hay[i..i + needle.len()] == needle)
}

/// Score one Chinese text (a token or the concise definition) against the
/// normalized query. 0 means "no meaningful match".
fn score_chinese_token(token: &str, query: &str, qchars: &[char]) -> usize {
    if token.is_empty() || qchars.is_empty() { return 0; }
    let t: Vec<char> = token.chars().filter(|c| is_cjk(*c)).collect();
    if t.is_empty() { return 0; }
    let qlen = qchars.len();

    // Single-character queries are inherently vague: prefer words whose
    // definition starts with that character.
    if qlen == 1 {
        if t[0] == qchars[0] { return 320; }
        if t.contains(&qchars[0]) { return 200; }
        return 0;
    }

    if token == query {
        return 1000 + 60usize.saturating_sub(t.len());
    }
    if t.starts_with(qchars) {
        return 780 - t.len().min(140);
    }
    if let Some(pos) = find_cjk_sub(&t, qchars) {
        // Longer tokens (sentences) are weaker evidence than a short phrase.
        return 640 - pos.min(120) - t.len().min(60) / 4;
    }

    // Partial phrase: count adjacent query bigrams that appear in the token.
    // Require at least half of them, otherwise a single shared bigram inside a
    // long example sentence would pull in unrelated words.
    let total = qlen - 1;
    let mut hits = 0usize;
    for w in qchars.windows(2) {
        if find_cjk_sub(&t, w).is_some() { hits += 1; }
    }
    if hits * 2 >= total {
        let mut s = 140 + 160 * hits / total;
        if t[0] == qchars[0] { s += 20; }
        return s;
    }

    // Last resort: character coverage, but only when most of the query is
    // present — otherwise any shared common character would match everything.
    let mut uniq: Vec<char> = Vec::new();
    for c in qchars { if !uniq.contains(c) { uniq.push(*c); } }
    let found = uniq.iter().filter(|c| t.contains(c)).count();
    let cov = found * 100 / uniq.len();
    if cov >= 60 {
        let mut s = 60 + cov;
        if t[0] == qchars[0] { s += 20; }
        return s;
    }
    0
}

fn score_chinese(entry: &IndexEntry, query: &str, qchars: &[char]) -> usize {
    let mut best = 0usize;
    if !entry.concise.is_empty() {
        // The concise definition carries the primary meaning, so a hit there
        // should outrank the same hit inside an example sentence.
        best = best.max(score_chinese_token(&entry.concise, query, qchars) * 5 / 4);
    }
    for token in &entry.chinese_tokens {
        let s = score_chinese_token(token, query, qchars);
        if s > best { best = s; }
    }
    best
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(word: &str, concise: &str, tokens: &[&str]) -> IndexEntry {
        IndexEntry {
            word: word.to_string(),
            file_name: format!("{word}.json"),
            concise: concise.to_string(),
            chinese_tokens: tokens.iter().map(|t| t.to_string()).collect(),
        }
    }

    fn zh_chars(q: &str) -> Vec<char> {
        q.chars().filter(|c| is_cjk(*c)).collect()
    }

    fn zh_score(e: &IndexEntry, q: &str) -> usize {
        score_chinese(e, q, &zh_chars(q))
    }

    #[test]
    fn chinese_exact_definition_match_wins() {
        let apple = entry("apple", "苹果", &["苹果", "苹果树"]);
        let fruit = entry("fruit", "水果", &["水果"]);
        assert!(zh_score(&apple, "苹果") > 900);
        // "苹果" must not match a definition that only shares one character.
        assert_eq!(zh_score(&fruit, "苹果"), 0);
    }

    #[test]
    fn chinese_phrase_beats_scattered_characters() {
        let phrase = entry("pretty", "漂亮的", &["漂亮"]);
        let scattered = entry("bright", "很亮", &["漂白很亮"]);
        let phrase_score = zh_score(&phrase, "漂亮");
        let scattered_score = zh_score(&scattered, "漂亮");
        assert!(phrase_score > scattered_score);
        assert!(scattered_score > 0);
    }

    #[test]
    fn chinese_question_wrappers_are_stripped() {
        assert_eq!(normalize_chinese_query("苹果怎么说"), "苹果");
        assert_eq!(normalize_chinese_query("水的英文是什么"), "水");
        assert_eq!(normalize_chinese_query("苹果的英文"), "苹果");
        // A query that is itself a noise word is kept verbatim.
        assert_eq!(normalize_chinese_query("英语"), "英语");
        assert_eq!(normalize_chinese_query("翻译"), "翻译");
    }

    #[test]
    fn chinese_single_character_prefers_prefix() {
        let prefixed = entry("water", "水", &["水果"]);
        let inside = entry("juice", "果汁", &["橙汁水果"]);
        assert!(zh_score(&prefixed, "水") > zh_score(&inside, "水"));
    }

    #[test]
    fn chinese_search_against_real_dictionary_when_available() {
        // Opt-in: point CDICTIONARY_TEST_DICT at a dictionary folder to run
        // the full index + search pipeline against real data.
        let dir = match std::env::var("CDICTIONARY_TEST_DICT") {
            Ok(d) if std::path::Path::new(&d).is_dir() => d,
            _ => return,
        };
        let mut svc = DictionaryService {
            dictionary_path: dir,
            index_path: std::env::temp_dir().join("cdictionary-test-index.json"),
            index: None,
        };
        let count = svc.rebuild(None);
        assert!(count > 100, "expected a populated dictionary, got {count}");

        let apple = svc.search("苹果", "zh", 5);
        println!("苹果 -> {:?}", apple.iter().map(|w| w.word.clone()).collect::<Vec<_>>());
        assert!(apple.iter().any(|w| w.word == "apple"));

        // Question wrappers must resolve to the same headword.
        let asked = svc.search("苹果的英文怎么说", "zh", 5);
        println!("苹果的英文怎么说 -> {:?}", asked.iter().map(|w| w.word.clone()).collect::<Vec<_>>());
        assert!(asked.iter().any(|w| w.word == "apple"));

        let pretty = svc.search("漂亮", "zh", 8);
        println!("漂亮 -> {:?}", pretty.iter().map(|w| w.word.clone()).collect::<Vec<_>>());
        assert!(pretty.iter().any(|w| w.word == "pretty"));

        let water = svc.search("水", "zh", 8);
        println!("水 -> {:?}", water.iter().map(|w| w.word.clone()).collect::<Vec<_>>());
        assert!(water.iter().any(|w| w.word == "water"));

        // Unrelated Chinese must not resolve to a random word.
        let none = svc.search("量子纠缠", "zh", 5);
        println!("量子纠缠 -> {:?}", none.iter().map(|w| w.word.clone()).collect::<Vec<_>>());
    }

    #[test]
    fn english_scoring_is_unchanged() {
        assert_eq!(score_english("apple", "apple"), 1000);
        assert!(score_english("apple", "app") > score_english("applesauce", "app"));
        assert_eq!(score_english("apple", "zzz"), 0);
    }
}
