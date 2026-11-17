//! Dictionary service. Scans a directory of per-word JSON files (the legacy
//! enriched schema and the ECDICT dict_json schema are both supported), builds
//! a compact binary search index and answers word lookups.
//!
//! The index lives in index.bin instead of index.json: 770k ECDICT entries would
//! make a JSON index hundreds of MB and several seconds to parse. The binary
//! form keeps the corpus in flat UTF-8 blobs (about 80 MB for ECDICT) and loads
//! in a fraction of a second.

use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state;
use crate::AppState;

const INDEX_VERSION: u32 = 5;
const INDEX_MAGIC: &[u8; 4] = b"EDIX";
/// Field separator between the display concise and the searchable text.
const FIELD_SEP: char = '\u{1f}';
/// Bit set in `Record::tag_mask` when the entry has a full learner entry
/// (ECDICT `isnormal = 1`: explanations + example sentences). Tag bits are
/// 1/2/4/8, so 1 << 16 stays clear of them.
const NORMAL_BIT: u32 = 1 << 16;

/// True while a (re)index is running. Commands return empty results instead of
/// blocking the UI behind the dictionary mutex for minutes.
static INDEXING: AtomicBool = AtomicBool::new(false);

pub fn is_indexing() -> bool {
    INDEXING.load(Ordering::Relaxed)
}

struct IndexingGuard;

impl IndexingGuard {
    fn acquire() -> Self {
        INDEXING.store(true, Ordering::SeqCst);
        IndexingGuard
    }
}

impl Drop for IndexingGuard {
    fn drop(&mut self) {
        INDEXING.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
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

/// Per-word JSON. The first fields are the legacy enriched schema; the second
/// block comes from ECDICT dict_json (translation / definition / tags / ...).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WordDefinition {
    pub word: String,
    #[serde(default)]
    pub pronunciation: String,
    #[serde(default)]
    pub concise_definition: String,
    #[serde(default)]
    pub phonetic: String,
    #[serde(default)]
    pub translation: String,
    #[serde(default)]
    pub definition: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub exchange: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forms: Option<HashMap<String, String>>,
    #[serde(default)]
    pub definitions: Vec<DefEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison: Option<Vec<Comparison>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isnormal: Option<i64>,
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

// ── Compact index ───────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Default)]
struct Record {
    word_off: u32,
    word_len: u32,
    file_off: u32,
    file_len: u32,
    zh_off: u32,
    zh_len: u32,
    /// Bitmask of common exam tags (zk/gk/cet4/cet6/ky/...) used for ranking,
    /// plus `NORMAL_BIT` for entries with a full learner entry.
    tag_mask: u32,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DictIndex {
    dictionary_path: String,
    updated_at: u64,
    records: Vec<Record>,
    words: Vec<u8>,
    files: Vec<u8>,
    zh: Vec<u8>,
}

fn slice_at(buf: &[u8], off: u32, len: u32) -> &[u8] {
    let start = off as usize;
    let end = start.saturating_add(len as usize);
    if end <= buf.len() { &buf[start..end] } else { &[] }
}

fn str_at(buf: &[u8], off: u32, len: u32) -> &str {
    std::str::from_utf8(slice_at(buf, off, len)).unwrap_or("")
}

impl DictIndex {
    pub(crate) fn count(&self) -> usize {
        self.records.len()
    }

    fn word(&self, i: usize) -> &str {
        let r = self.records[i];
        str_at(&self.words, r.word_off, r.word_len)
    }

    fn file(&self, i: usize) -> &str {
        let r = self.records[i];
        str_at(&self.files, r.file_off, r.file_len)
    }

    fn text(&self, i: usize) -> &str {
        let r = self.records[i];
        str_at(&self.zh, r.zh_off, r.zh_len)
    }

    /// The display concise is stored before the FIELD_SEP marker.
    fn concise(&self, i: usize) -> &str {
        let text = self.text(i);
        match text.find(FIELD_SEP) {
            Some(pos) => &text[..pos],
            None => text,
        }
    }

    fn tag_mask(&self, i: usize) -> u32 {
        self.records[i].tag_mask
    }

    fn lower_bound(&self, word: &str) -> usize {
        self.records
            .partition_point(|r| cmp_ci(str_at(&self.words, r.word_off, r.word_len), word) == std::cmp::Ordering::Less)
    }

    fn find_exact(&self, word: &str) -> Option<usize> {
        let q = word.trim();
        if q.is_empty() { return None; }
        let i = self.lower_bound(q);
        if i < self.records.len() && self.word(i).eq_ignore_ascii_case(q) {
            Some(i)
        } else {
            None
        }
    }
}

fn write_u32(w: &mut impl Write, v: u32) -> std::io::Result<()> {
    w.write_all(&v.to_le_bytes())
}

fn read_u32(r: &mut impl Read) -> Option<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b).ok()?;
    Some(u32::from_le_bytes(b))
}

fn read_u64(r: &mut impl Read) -> Option<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b).ok()?;
    Some(u64::from_le_bytes(b))
}

fn read_blob(r: &mut impl Read) -> Option<Vec<u8>> {
    let len = read_u32(r)? as usize;
    if len > 1_000_000_000 { return None; }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).ok()?;
    Some(buf)
}

fn write_index(idx: &DictIndex, path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let file = fs::File::create(path)?;
    let mut w = BufWriter::new(file);
    w.write_all(INDEX_MAGIC)?;
    write_u32(&mut w, INDEX_VERSION)?;
    w.write_all(&idx.updated_at.to_le_bytes())?;
    let p = idx.dictionary_path.as_bytes();
    write_u32(&mut w, p.len() as u32)?;
    w.write_all(p)?;
    write_u32(&mut w, idx.records.len() as u32)?;
    for r in &idx.records {
        for v in [r.word_off, r.word_len, r.file_off, r.file_len, r.zh_off, r.zh_len, r.tag_mask] {
            write_u32(&mut w, v)?;
        }
    }
    for blob in [&idx.words, &idx.files, &idx.zh] {
        write_u32(&mut w, blob.len() as u32)?;
        w.write_all(blob)?;
    }
    w.flush()
}

fn read_index(path: &Path, expected_path: &str) -> Option<DictIndex> {
    let file = fs::File::open(path).ok()?;
    let mut r = BufReader::new(file);
    let mut magic = [0u8; 4];
    r.read_exact(&mut magic).ok()?;
    if &magic != INDEX_MAGIC { return None; }
    if read_u32(&mut r)? != INDEX_VERSION { return None; }
    let updated_at = read_u64(&mut r)?;
    let path_len = read_u32(&mut r)? as usize;
    if path_len > 1_000_000 { return None; }
    let mut path_buf = vec![0u8; path_len];
    r.read_exact(&mut path_buf).ok()?;
    let dictionary_path = String::from_utf8(path_buf).ok()?;
    if dictionary_path != expected_path { return None; }
    let count = read_u32(&mut r)? as usize;
    if count > 5_000_000 { return None; }
    let mut records = Vec::with_capacity(count);
    for _ in 0..count {
        records.push(Record {
            word_off: read_u32(&mut r)?,
            word_len: read_u32(&mut r)?,
            file_off: read_u32(&mut r)?,
            file_len: read_u32(&mut r)?,
            zh_off: read_u32(&mut r)?,
            zh_len: read_u32(&mut r)?,
            tag_mask: read_u32(&mut r)?,
        });
    }
    let words = read_blob(&mut r)?;
    let files = read_blob(&mut r)?;
    let zh = read_blob(&mut r)?;
    Some(DictIndex { dictionary_path, updated_at, records, words, files, zh })
}

// ── Build ──────────────────────────────────────────────────────────────────

pub(crate) struct BuildEntry {
    word: String,
    file_name: String,
    search_text: String,
    tag_mask: u32,
    /// ECDICT `isnormal = 1` (or a legacy entry without the field): has full
    /// explanations and example sentences, so it is worth showing as a random
    /// word and is ranked slightly higher in Chinese lookup.
    normal: bool,
}

fn tag_mask_from(tags: &[String]) -> u32 {
    let mut mask = 0u32;
    for tag in tags {
        match tag.to_ascii_lowercase().as_str() {
            "zk" | "gk" => mask |= 1,
            "cet4" | "cet6" => mask |= 2,
            "ky" | "toefl" | "ielts" | "gre" => mask |= 4,
            _ => {}
        }
        mask |= 8;
    }
    mask
}

/// Tags are the only commonness signal in the ECDICT data: 77万 entries include
/// many obscure abbreviations, and without this "漂亮" ranks sug/plmm/dink
/// above pretty.
fn tag_bonus(mask: u32) -> usize {
    let mut bonus = 0;
    if mask & 1 != 0 { bonus += 60; }
    if mask & 2 != 0 { bonus += 20; }
    if mask & 4 != 0 { bonus += 10; }
    if mask & 8 != 0 { bonus += 30; }
    bonus
}

fn list_json_files(dir: &str) -> Vec<String> {
    if dir.is_empty() { return Vec::new(); }
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.ends_with(".json"))
                .collect()
        })
        .unwrap_or_default()
}

/// Parse one dictionary JSON into an index row. Shared by the directory
/// scanner and the zip importer (which has the bytes already in memory).
pub(crate) fn build_entry_from_json(file_name: &str, raw: &str) -> Option<BuildEntry> {
    let data: WordDefinition = serde_json::from_str(raw).ok()?;
    Some(build_entry_from_data(data, file_name))
}

/// Same as build_entry_from_json but for callers that already parsed the JSON
/// (the JSONL pack importer parses each line once and reuses it).
pub(crate) fn build_entry_from_data(data: WordDefinition, file_name: &str) -> BuildEntry {
    let data = normalize_entry(data);
    let mut search_text = String::with_capacity(data.concise_definition.len() + data.translation.len() + 128);
    search_text.push_str(&data.concise_definition);
    search_text.push(FIELD_SEP);
    search_text.push_str(&data.translation);
    // Explanations help, but examples caused false positives (a surname whose
    // example sentence mentions "量子纠缠" outranked the actual entries), so
    // they are intentionally left out of the searchable text.
    for d in &data.definitions {
        if !d.explanation_cn.is_empty() {
            search_text.push(' ');
            search_text.push_str(&d.explanation_cn);
        }
    }
    // isnormal = 0 entries only carry translation/definition; they are still
    // searchable and displayable (normalize_entry synthesises the cards), but
    // they are not offered as "random word" candidates.
    let normal = data.isnormal != Some(0);
    let mut tag_mask = tag_mask_from(&data.tags);
    if normal { tag_mask |= NORMAL_BIT; }
    BuildEntry { word: data.word, file_name: file_name.to_string(), search_text, tag_mask, normal }
}

/// Windows reserves CON/PRN/AUX/NUL/COM1..9/LPT1..9 as device names, even with
/// an extension; writing con.json fails with an invalid-name error. ECDICT has
/// real words such as "con" and "aux", so escape them with a trailing underscore.
const RESERVED_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn short_hash(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// File name for a word when the source has no per-word file (JSONL pack).
/// Mirrors the historic Electron naming so imported packs look like the zips.
///
/// Words containing punctuation/spaces (and Windows device names) get a stable
/// hash suffix: ECDICT has entries like "'hood" and "-hood" that would both
/// sanitise to hood.json and overwrite each other. 10k of the 770k entries
/// collide without this.
pub(crate) fn json_file_name(word: &str) -> String {
    let mut out = String::new();
    for c in word.chars() {
        if c.is_ascii_alphanumeric() { out.extend(c.to_lowercase()); }
        else { out.push('_'); }
    }
    let mut trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        trimmed = "word".to_string();
    }
    let plain = word.chars().all(|c| c.is_ascii_alphanumeric());
    if !word.is_empty() && (!plain || RESERVED_NAMES.contains(&trimmed.as_str())) {
        trimmed.push_str(&format!("_{:08x}", short_hash(word)));
    }
    format!("{}.json", trimmed)
}

fn build_one(path: &Path, file_name: &str) -> Option<BuildEntry> {
    let raw = fs::read_to_string(path).ok()?;
    build_entry_from_json(file_name, &raw)
}

/// Build a compact index from a dictionary folder. Files are read in parallel
/// batches so 770k entries take minutes, not an hour. Progress is per batch.
fn build_index(dictionary_path: &str, on_progress: Option<&dyn Fn(usize)>) -> DictIndex {
    let _guard = IndexingGuard::acquire();
    let mut files = list_json_files(dictionary_path);
    files.sort();

    let total = files.len();
    let mut entries: Vec<BuildEntry> = Vec::with_capacity(total);
    let dir = Path::new(dictionary_path);
    let batch_size = 2048usize;
    for (batch_idx, batch) in files.chunks(batch_size).enumerate() {
        let built: Vec<BuildEntry> = batch
            .par_iter()
            .filter_map(|name| build_one(&dir.join(name), name))
            .collect();
        entries.extend(built);
        if let Some(cb) = on_progress {
            let done = ((batch_idx + 1) * batch_size).min(total);
            cb(done);
        }
    }

    finalize_index(dictionary_path, entries)
}

/// Turn parsed rows into the on-disk index (sort, dedupe, pack blobs).
pub(crate) fn finalize_index(dictionary_path: &str, mut entries: Vec<BuildEntry>) -> DictIndex {
    entries.sort_unstable_by(|a, b| cmp_ci(&a.word, &b.word).then_with(|| a.word.cmp(&b.word)));
    entries.dedup_by(|a, b| a.word.eq_ignore_ascii_case(&b.word));

    let mut words: Vec<u8> = Vec::with_capacity(entries.len() * 12);
    let mut files_blob: Vec<u8> = Vec::with_capacity(entries.len() * 14);
    let mut zh: Vec<u8> = Vec::with_capacity(entries.len() * 48);
    let mut records: Vec<Record> = Vec::with_capacity(entries.len());
    for e in &entries {
        let word_off = words.len() as u32;
        words.extend_from_slice(e.word.as_bytes());
        let file_off = files_blob.len() as u32;
        files_blob.extend_from_slice(e.file_name.as_bytes());
        let zh_off = zh.len() as u32;
        zh.extend_from_slice(e.search_text.as_bytes());
        records.push(Record {
            word_off,
            word_len: e.word.len() as u32,
            file_off,
            file_len: e.file_name.len() as u32,
            zh_off,
            zh_len: e.search_text.len() as u32,
            tag_mask: e.tag_mask | if e.normal { NORMAL_BIT } else { 0 },
        });
    }

    DictIndex {
        dictionary_path: dictionary_path.to_string(),
        updated_at: now_ms(),
        records,
        words,
        files: files_blob,
        zh,
    }
}

// ── Service ────────────────────────────────────────────────────────────────

pub struct DictionaryService {
    dictionary_path: String,
    index_path: PathBuf,
    index: Option<DictIndex>,
}

#[cfg(test)]
pub(crate) fn write_index_for_test(idx: &DictIndex, path: &Path) {
    let _ = write_index(idx, path);
}

impl DictionaryService {
    #[cfg(test)]
    pub(crate) fn new_for_test(dictionary_path: String, index_path: PathBuf, idx: DictIndex) -> Self {
        Self { dictionary_path, index_path, index: Some(idx) }
    }

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
            "count": self.index.as_ref().map(|i| i.records.len()).unwrap_or(0),
            "lastUpdated": self.index.as_ref().map(|i| i.updated_at).unwrap_or(0),
            "indexing": false,
        })
    }

    fn load_index(&mut self) {
        if let Some(idx) = read_index(&self.index_path, &self.dictionary_path) {
            self.index = Some(idx);
        }
    }

    fn save_index(&self) {
        if let Some(idx) = &self.index {
            let _ = write_index(idx, &self.index_path);
        }
    }

    /// Install an index built elsewhere (e.g. while extracting a zip) and
    /// persist it.
    pub(crate) fn apply_index(&mut self, idx: DictIndex) {
        self.index = Some(idx);
        self.save_index();
    }

    /// Rebuild the search index. on_progress receives the number of files
    /// indexed so far.
    pub fn rebuild(&mut self, on_progress: Option<&dyn Fn(usize)>) -> usize {
        let idx = build_index(&self.dictionary_path, on_progress);
        let count = idx.records.len();
        self.index = Some(idx);
        self.save_index();
        count
    }

    pub fn get_word(&self, word: &str) -> Option<WordDefinition> {
        let idx = self.index.as_ref()?;
        let i = idx.find_exact(word)?;
        self.read_entry(i)
    }

    fn read_entry(&self, i: usize) -> Option<WordDefinition> {
        let idx = self.index.as_ref()?;
        let path = Path::new(&self.dictionary_path).join(idx.file(i));
        let raw = fs::read_to_string(path).ok()?;
        let data: WordDefinition = serde_json::from_str(&raw).ok()?;
        Some(normalize_entry(data))
    }

    pub fn get_words(&self, words: &[String]) -> Vec<Option<WordDefinition>> {
        let idx = match &self.index {
            Some(i) => i,
            None => return words.iter().map(|_| None).collect(),
        };
        words
            .iter()
            .map(|w| idx.find_exact(w).and_then(|i| self.read_entry(i)))
            .collect()
    }

    pub fn get_random_word(&self) -> Option<WordDefinition> {
        let idx = self.index.as_ref()?;
        let total = idx.records.len();
        if total == 0 { return None; }
        use rand::Rng;
        let mut rng = rand::thread_rng();

        // ECDICT only enriches a small fraction of its entries (isnormal = 1).
        // Those carry explanations and example sentences, so picking from them
        // keeps the "random word" card complete and costs a single file read —
        // probing random entries used to fail ~24 times and then fall back.
        let pool: Vec<u32> = idx
            .records
            .iter()
            .enumerate()
            .filter_map(|(i, r)| if r.tag_mask & NORMAL_BIT != 0 { Some(i as u32) } else { None })
            .collect();
        let has_pool = !pool.is_empty();
        for _ in 0..4 {
            let i = if has_pool {
                pool[rng.gen_range(0..pool.len())] as usize
            } else {
                rng.gen_range(0..total)
            };
            if let Some(data) = self.read_entry(i) {
                return Some(data);
            }
        }
        None
    }

    pub fn add_word(&mut self, entry: &WordDefinition) -> WordDefinition {
        let normalized = normalize_entry(entry.clone());
        let file_name = json_file_name(&normalized.word);
        if !self.dictionary_path.is_empty() {
            let _ = fs::create_dir_all(&self.dictionary_path);
            let path = Path::new(&self.dictionary_path).join(&file_name);
            if let Ok(json) = serde_json::to_string_pretty(&normalized) {
                let _ = fs::write(path, json);
            }
        }
        if let Some(idx) = &mut self.index {
            let mut search_text = String::new();
            search_text.push_str(&normalized.concise_definition);
            search_text.push(FIELD_SEP);
            search_text.push_str(&normalized.translation);
            for d in &normalized.definitions {
                if !d.explanation_cn.is_empty() {
                    search_text.push(' ');
                    search_text.push_str(&d.explanation_cn);
                }
            }
            let word_off = idx.words.len() as u32;
            idx.words.extend_from_slice(normalized.word.as_bytes());
            let file_off = idx.files.len() as u32;
            idx.files.extend_from_slice(file_name.as_bytes());
            let zh_off = idx.zh.len() as u32;
            idx.zh.extend_from_slice(search_text.as_bytes());
            let rec = Record {
                word_off,
                word_len: normalized.word.len() as u32,
                file_off,
                file_len: file_name.len() as u32,
                zh_off,
                zh_len: search_text.len() as u32,
                tag_mask: tag_mask_from(&normalized.tags)
                    | if normalized.isnormal != Some(0) { NORMAL_BIT } else { 0 },
            };
            match idx.find_exact(&normalized.word) {
                Some(i) => idx.records[i] = rec,
                None => {
                    let pos = idx.lower_bound(&normalized.word);
                    idx.records.insert(pos, rec);
                }
            }
        }
        self.save_index();
        normalized
    }

    pub fn delete_word(&mut self, word: &str) -> bool {
        let idx = match &mut self.index { Some(i) => i, None => return false };
        let i = match idx.find_exact(word) { Some(i) => i, None => return false };
        let file = idx.file(i).to_string();
        let path = Path::new(&self.dictionary_path).join(&file);
        let _ = fs::remove_file(path);
        idx.records.remove(i);
        self.save_index();
        true
    }

    pub fn search(&self, query: &str, lang: &str, limit: usize) -> Vec<WordEntry> {
        let idx = match &self.index { Some(i) => i, None => return vec![] };
        let raw = query.trim();
        if raw.is_empty() { return vec![]; }

        // 770k entries: scan in parallel, then rank the (usually few) matches.
        let scored: Vec<(usize, usize)> = if lang == "en" {
            let q = raw.to_ascii_lowercase();
            if q.is_empty() { return vec![]; }
            let qchars: Vec<char> = q.chars().collect();
            (0..idx.records.len())
                .into_par_iter()
                .filter_map(|i| {
                    let s = score_english(idx.word(i), &q, &qchars);
                    if s > 0 { Some((s + tag_bonus(idx.tag_mask(i)), i)) } else { None }
                })
                .collect()
        } else {
            let normalized = normalize_chinese_query(raw);
            let qchars: Vec<char> = normalized.chars().filter(|c| is_cjk(*c)).collect();
            if qchars.is_empty() { return vec![]; }
            let bigrams: Vec<String> = qchars.windows(2).map(|w| w.iter().collect()).collect();
            let mut uniq: Vec<char> = Vec::new();
            for c in &qchars {
                if !uniq.contains(c) { uniq.push(*c); }
            }
            (0..idx.records.len())
                .into_par_iter()
                .filter_map(|i| {
                    let s = score_chinese_index(idx, i, &normalized, &qchars, &bigrams, &uniq);
                    if s > 0 { Some((s, i)) } else { None }
                })
                .collect()
        };
        let mut scored = scored;

        scored.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| idx.word(a.1).chars().count().cmp(&idx.word(b.1).chars().count()))
                .then_with(|| idx.word(a.1).cmp(idx.word(b.1)))
        });
        scored.into_iter().take(limit).map(|(_, i)| WordEntry {
            word: idx.word(i).to_string(),
            file_name: idx.file(i).to_string(),
            concise: Some(idx.concise(i).to_string()),
        }).collect()
    }
}

// ── Text helpers ───────────────────────────────────────────────────────────

fn cmp_ci(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let mut ai = a.bytes();
    let mut bi = b.bytes();
    loop {
        match (ai.next(), bi.next()) {
            (Some(x), Some(y)) => {
                let x = x.to_ascii_lowercase();
                let y = y.to_ascii_lowercase();
                if x != y { return x.cmp(&y); }
            }
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
        }
    }
}

fn starts_with_ci(hay: &str, needle: &str) -> bool {
    if needle.is_empty() { return true; }
    hay.get(..needle.len())
        .map(|s| s.eq_ignore_ascii_case(needle))
        .unwrap_or(false)
}

fn contains_ci(hay: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() { return Some(0); }
    if hay.len() < needle.len() { return None; }
    for (i, _) in hay.char_indices() {
        if i + needle.len() > hay.len() { break; }
        if let Some(candidate) = hay.get(i..i + needle.len()) {
            if candidate.eq_ignore_ascii_case(needle) { return Some(i); }
        }
    }
    None
}

fn score_english(word: &str, query: &str, qchars: &[char]) -> usize {
    if word.eq_ignore_ascii_case(query) { return 1000; }
    let len = word.chars().count();
    if starts_with_ci(word, query) { return 500usize.saturating_sub(len); }
    if contains_ci(word, query).is_some() { return 200usize.saturating_sub(len); }
    fuzzy_score_ci(word, qchars)
}

fn fuzzy_score_ci(word: &str, qchars: &[char]) -> usize {
    let mut qi = 0usize;
    let mut score: isize = 0;
    let wlen = word.chars().count() as isize;
    for c in word.chars() {
        if qi < qchars.len() {
            if c.to_ascii_lowercase() == qchars[qi] {
                score += 10;
                qi += 1;
            }
        } else {
            break;
        }
    }
    if qi == qchars.len() {
        let s = score - wlen;
        if s > 0 { s as usize } else { 0 }
    } else {
        0
    }
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

fn first_cjk(text: &str) -> Option<char> {
    text.chars().find(|c| is_cjk(*c))
}

/// Score a raw Chinese text (concise, translation, explanations) without
/// allocating per entry. Mirrors the previous token scoring: phrase first,
/// then adjacent bigrams, then character coverage.
fn score_chinese_text(
    text: &str,
    query: &str,
    qchars: &[char],
    bigrams: &[String],
    uniq: &[char],
) -> usize {
    if text.is_empty() || qchars.is_empty() { return 0; }
    let first = first_cjk(text);
    if qchars.len() == 1 {
        if text.contains(qchars[0]) {
            let mut s = 200;
            if first == Some(qchars[0]) { s += 120; }
            return s;
        }
        return 0;
    }

    if let Some(pos) = text.find(query) {
        let mut s = if pos == 0 { 780 } else { 640usize.saturating_sub(pos.min(240) / 3) };
        s = s.saturating_sub(text.len().min(600) / 12);
        if first == Some(qchars[0]) { s += 20; }
        return s.max(1);
    }

    let total = qchars.len() - 1;
    let mut hits = 0usize;
    for bg in bigrams {
        if text.contains(bg.as_str()) { hits += 1; }
    }
    if hits * 2 >= total {
        let mut s = 140 + 160 * hits / total;
        if first == Some(qchars[0]) { s += 20; }
        return s;
    }

    // Character coverage only rescues short queries. Long queries require the
    // whole phrase: otherwise "量子纠缠" matches a mosquito explanation that
    // happens to contain 子 + 纠 + 缠.
    let need = match qchars.len() {
        2 => 60,
        3 => 67,
        _ => 100,
    };
    let found = uniq.iter().filter(|c| text.contains(**c)).count();
    let cov = found * 100 / uniq.len();
    if cov >= need {
        let mut s = 60 + cov;
        if first == Some(qchars[0]) { s += 20; }
        return s;
    }
    0
}

const POS_PREFIXES: &[&str] = &[
    "n. ", "v. ", "vt. ", "vi. ", "a. ", "adj. ", "adv. ", "prep. ", "conj. ", "pron. ",
    "num. ", "art. ", "int. ", "aux. ", "abbr. ", "pl. ", "sing. ", "phr. ",
];

/// Zero-allocation variant of split_pos for hot search loops.
fn body_after_pos(s: &str) -> &str {
    if let Some(rest) = s.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            if end <= 8 {
                return rest[end + 1..].trim_start();
            }
        }
    }
    for prefix in POS_PREFIXES {
        if let Some(body) = s.strip_prefix(prefix) {
            return body.trim_start();
        }
    }
    s
}

/// Only grammatical markers count as a headword signal; bracket markers such
/// as [医] / [美] are domain notes, not parts of speech.
fn has_pos_marker(s: &str) -> bool {
    POS_PREFIXES.iter().any(|prefix| s.starts_with(prefix))
}

/// Chinese ranking favours dictionary headwords: a concise definition whose
/// leading POS marker is followed by the query ("n. 苹果, ...") beats a phrase
/// that merely happens to start with it ("漂亮的姑娘"). Only when the concise
/// does not match do we scan translations and examples.
fn score_chinese_index(
    idx: &DictIndex,
    i: usize,
    query: &str,
    qchars: &[char],
    bigrams: &[String],
    uniq: &[char],
) -> usize {
    let text = idx.text(i);
    let concise_len = text.find(FIELD_SEP).unwrap_or(0);
    let mut best = 0usize;
    if concise_len > 0 {
        let concise = &text[..concise_len];
        let pos_bonus = if has_pos_marker(concise) { 40 } else { 0 };
        let body = body_after_pos(concise);
        if concise == query {
            // A bare "水" translation is a valid hit, but a proper headword
            // entry ("n. 水, 液体") should still rank above it.
            best = if pos_bonus > 0 { 1300 } else { 900 };
        } else if let Some(rest) = body.strip_prefix(query) {
            // Query is the first meaning of the headword. A delimiter after it
            // ("苹果, 苹果树") beats a longer compound ("苹果移动操作系统").
            let boundary = match rest.chars().next() {
                None => true,
                Some(c) => matches!(
                    c,
                    ',' | '，' | ';' | '；' | '、' | ' ' | '\n' | '。' | ':' | '：' | '的' | ')' | '）'
                ),
            };
            best = 1200 + if boundary { 120 } else { 0 } + pos_bonus;
        } else if concise.contains(query) {
            best = 800 + pos_bonus;
        }
    }
    if best == 0 {
        let core_start = if concise_len > 0 { concise_len + FIELD_SEP.len_utf8() } else { 0 };
        let core = &text[core_start..];
        best = score_chinese_text(core, query, qchars, bigrams, uniq);
    }
    if best == 0 { 0 } else { best + tag_bonus(idx.tag_mask(i)) }
}

// ── Schema normalisation (ECDICT -> app display shape) ─────────────────────

fn truncate_chars(s: &mut String, max: usize) {
    if s.chars().count() > max {
        if let Some((idx, _)) = s.char_indices().nth(max) {
            s.truncate(idx);
            s.push('…');
        }
    }
}

fn first_text_line(text: &str) -> &str {
    text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("")
}

fn concise_from_translation(translation: &str) -> String {
    let mut out = first_text_line(translation).to_string();
    truncate_chars(&mut out, 120);
    out
}

fn parse_exchange_code(code: &str) -> Option<&'static str> {
    match code {
        "s" => Some("复数"),
        "p" => Some("过去式"),
        "d" => Some("过去分词"),
        "i" => Some("现在分词"),
        "3" => Some("第三人称单数"),
        "r" => Some("比较级"),
        "t" => Some("最高级"),
        "0" => Some("原形"),
        "1" => Some("派生"),
        _ => None,
    }
}

fn parse_exchange(exchange: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for part in exchange.split('/') {
        let mut it = part.splitn(2, ':');
        let code = it.next().unwrap_or("").trim();
        let value = it.next().unwrap_or("").trim();
        if value.is_empty() { continue; }
        if let Some(label) = parse_exchange_code(code) {
            map.insert(label.to_string(), value.to_string());
        }
    }
    map
}

/// Split a leading POS marker from a translation line: "n. 苹果" -> ("n.", "苹果"),
/// "[网络] 胡德" -> ("[网络]", "胡德").
fn split_pos(line: &str) -> (String, String) {
    let t = line.trim_start();
    if let Some(rest) = t.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let tag = &rest[..end];
            if !tag.is_empty() && tag.chars().count() <= 8 {
                return (format!("[{}]", tag), rest[end + 1..].trim_start().to_string());
            }
        }
    }
    let mut letters = 0usize;
    for (i, c) in t.char_indices() {
        if c == '.' && i > 0 && letters <= 5 {
            let word = &t[..i];
            if matches!(
                word,
                "n" | "v" | "vt" | "vi" | "adj" | "adv" | "prep" | "conj" | "pron"
                    | "num" | "art" | "int" | "aux" | "abbr" | "pl" | "sing" | "phr"
            ) {
                return (format!("{}.", word), t[i + 1..].trim_start().to_string());
            }
        }
        if c.is_ascii_alphabetic() { letters += 1; } else { break; }
    }
    (String::new(), t.to_string())
}

fn synthesize_definitions(translation: &str, definition: &str) -> Vec<DefEntry> {
    let mut defs: Vec<DefEntry> = Vec::new();
    for line in translation.lines().map(str::trim).filter(|l| !l.is_empty()).take(8) {
        let (pos, body) = split_pos(line);
        defs.push(DefEntry { pos, explanation_cn: body, ..Default::default() });
    }
    let english: Vec<&str> = definition.lines().map(str::trim).filter(|l| !l.is_empty()).take(8).collect();
    if defs.is_empty() {
        if !english.is_empty() {
            defs.push(DefEntry {
                pos: String::new(),
                explanation_en: english.join("\n"),
                ..Default::default()
            });
        }
    } else if !english.is_empty() {
        defs[0].explanation_en = english.join("\n");
    }
    defs
}

/// ECDICT dict_json stores line breaks double-escaped: the file contains
/// backslash-backslash-n, so after JSON parsing the string holds a literal
/// backslash + "n" instead of a newline. Turn those back into real line breaks,
/// otherwise the whole translation collapses into one unreadable card.
fn unescape_literal_newlines(s: &str) -> String {
    if !s.contains("\\n") && !s.contains("\\r") {
        return s.to_string();
    }
    s.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")
}

fn normalize_entry(mut d: WordDefinition) -> WordDefinition {
    if d.pronunciation.trim().is_empty() {
        d.pronunciation = d.phonetic.trim().to_string();
    }
    d.translation = unescape_literal_newlines(&d.translation);
    d.definition = unescape_literal_newlines(&d.definition);
    d.concise_definition = unescape_literal_newlines(&d.concise_definition);
    if d.concise_definition.trim().is_empty() {
        d.concise_definition = concise_from_translation(&d.translation);
    } else {
        d.concise_definition = d.concise_definition.trim().to_string();
    }
    d.tags.retain(|t| !t.trim().is_empty());
    if d.forms.as_ref().map(|m| m.is_empty()).unwrap_or(true) {
        let forms = parse_exchange(&d.exchange);
        if !forms.is_empty() { d.forms = Some(forms); }
    }
    if d.definitions.is_empty() && (!d.translation.is_empty() || !d.definition.is_empty()) {
        d.definitions = synthesize_definitions(&d.translation, &d.definition);
    }
    d
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn dict_search(app_state: State<'_, AppState>, query: String, lang: String, limit: Option<usize>) -> Vec<WordEntry> {
    if is_indexing() { return vec![]; }
    let d = app_state.dict.lock().unwrap();
    d.search(&query, &lang, limit.unwrap_or(20))
}

#[tauri::command]
pub fn dict_get_word(app_state: State<'_, AppState>, word: String) -> Option<WordDefinition> {
    if is_indexing() { return None; }
    app_state.dict.lock().unwrap().get_word(&word)
}

#[tauri::command]
pub fn dict_get_words(app_state: State<'_, AppState>, words: Vec<String>) -> Vec<Option<WordDefinition>> {
    if is_indexing() { return words.iter().map(|_| None).collect(); }
    let d = app_state.dict.lock().unwrap();
    d.get_words(&words)
}

#[tauri::command]
pub fn dict_rebuild_index(app_state: State<'_, AppState>) -> serde_json::Value {
    if is_indexing() {
        return serde_json::json!({ "success": false, "count": 0, "indexing": true });
    }
    let mut d = app_state.dict.lock().unwrap();
    let count = d.rebuild(None);
    serde_json::json!({ "success": true, "count": count, "indexing": false })
}

#[tauri::command]
pub fn dict_index_status(app_state: State<'_, AppState>) -> serde_json::Value {
    if is_indexing() {
        return serde_json::json!({ "exists": false, "count": 0, "lastUpdated": 0, "indexing": true });
    }
    app_state.dict.lock().unwrap().status()
}

#[tauri::command]
pub fn dict_add_word(app_state: State<'_, AppState>, entry: WordDefinition) -> WordDefinition {
    if is_indexing() { return entry; }
    let mut d = app_state.dict.lock().unwrap();
    d.add_word(&entry)
}

#[tauri::command]
pub fn dict_delete_word(app_state: State<'_, AppState>, word: String) -> bool {
    if is_indexing() { return false; }
    let mut d = app_state.dict.lock().unwrap();
    d.delete_word(&word)
}

#[tauri::command]
pub fn dict_random_word(app_state: State<'_, AppState>) -> Option<WordDefinition> {
    if is_indexing() { return None; }
    app_state.dict.lock().unwrap().get_random_word()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zh_chars(q: &str) -> Vec<char> {
        q.chars().filter(|c| is_cjk(*c)).collect()
    }

    fn zh_score(text: &str, q: &str) -> usize {
        let qchars = zh_chars(q);
        let bigrams: Vec<String> = qchars.windows(2).map(|w| w.iter().collect()).collect();
        let mut uniq: Vec<char> = Vec::new();
        for c in &qchars {
            if !uniq.contains(c) { uniq.push(*c); }
        }
        score_chinese_text(text, q, &qchars, &bigrams, &uniq)
    }

    const APPLE_ECDICT: &str = r#"{
      "word": "apple",
      "phonetic": "'æpl",
      "translation": "n. 苹果, 家伙\n[医] 苹果",
      "definition": "n. fruit with red or yellow or green skin\nn. native Eurasian tree",
      "tags": ["zk", "gk"],
      "exchange": "s:apples",
      "pronunciation": "",
      "concise_definition": "",
      "forms": {},
      "definitions": [],
      "comparison": [],
      "isnormal": 0
    }"#;

    #[test]
    fn ecdict_entry_is_normalised_for_display() {
        let data: WordDefinition = serde_json::from_str(APPLE_ECDICT).unwrap();
        let n = normalize_entry(data);
        assert_eq!(n.pronunciation, "'æpl");
        assert!(n.concise_definition.starts_with("n. 苹果"));
        assert_eq!(n.tags, vec!["zk", "gk"]);
        let forms = n.forms.unwrap();
        assert_eq!(forms.get("复数").map(String::as_str), Some("apples"));
        assert!(n.definitions.len() >= 2, "translation lines become definition cards");
        assert_eq!(n.definitions[0].pos, "n.");
        assert!(n.definitions[0].explanation_cn.contains("苹果"));
        assert!(n.definitions[0].explanation_en.contains("fruit"));
        assert_eq!(n.definitions[1].pos, "[医]");
    }

    #[test]
    fn enriched_schema_still_works() {
        let raw = r#"{
          "word": "pretty",
          "pronunciation": "pret·ee",
          "concise_definition": "adj. 漂亮的",
          "forms": {"comparative": "prettier"},
          "definitions": [{"pos":"adjective","explanation_en":"Attractive.","explanation_cn":"漂亮的","example_en":"She is pretty.","example_cn":"她很漂亮。"}],
          "comparison": []
        }"#;
        let data: WordDefinition = serde_json::from_str(raw).unwrap();
        let n = normalize_entry(data);
        assert_eq!(n.pronunciation, "pret·ee");
        assert_eq!(n.definitions.len(), 1);
        assert_eq!(n.forms.unwrap().get("comparative").map(String::as_str), Some("prettier"));
    }

    #[test]
    fn chinese_exact_definition_wins_over_partial() {
        assert!(zh_score("苹果\x1f n. 苹果, 苹果树", "苹果") > 700);
        assert_eq!(zh_score("水果\x1f n. 水果", "苹果"), 0);
    }

    #[test]
    fn chinese_phrase_beats_scattered_characters() {
        let phrase = zh_score("漂亮的\x1f adj. 漂亮的", "漂亮");
        let scattered = zh_score("很亮\x1f 漂白很亮", "漂亮");
        assert!(phrase > scattered);
        assert!(scattered > 0);
    }

    #[test]
    fn chinese_question_wrappers_are_stripped() {
        assert_eq!(normalize_chinese_query("苹果怎么说"), "苹果");
        assert_eq!(normalize_chinese_query("水的英文是什么"), "水");
        assert_eq!(normalize_chinese_query("苹果的英文"), "苹果");
        assert_eq!(normalize_chinese_query("英语"), "英语");
    }

    #[test]
    fn chinese_single_character_prefers_first_position() {
        assert!(zh_score("水\x1f 水, 液体", "水") > zh_score("果汁\x1f 橙汁水果", "水"));
    }

    /// Opt-in: point ED_TEST_DICT at a dictionary folder to run the full index +
    /// search pipeline against real data (e.g. the installed 2.5 万词条词库).
    #[test]
    fn chinese_search_against_real_dictionary_when_available() {
        let dir = match std::env::var("ED_TEST_DICT") {
            Ok(d) if std::path::Path::new(&d).is_dir() => d,
            _ => return,
        };
        let mut svc = DictionaryService {
            dictionary_path: dir,
            index_path: std::env::temp_dir().join("ed-test-index.bin"),
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
        let q = "apple";
        assert_eq!(score_english("apple", q, &q.chars().collect::<Vec<_>>()), 1000);
        assert!(score_english("applesauce", "app", &q.chars().collect::<Vec<_>>()) < 500);
        assert_eq!(score_english("apple", "zzz", &"zzz".chars().collect::<Vec<_>>()), 0);
    }

    #[test]
    fn index_roundtrip_and_search_on_small_folder() {
        let dir = std::env::temp_dir().join("edict-index-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("apple.json"), APPLE_ECDICT).unwrap();
        fs::write(
            dir.join("pretty.json"),
            r#"{"word":"pretty","phonetic":"'prɪti","translation":"adj. 漂亮的, 优美的","definition":"","tags":[],"exchange":"r:prettier/t:prettiest","definitions":[],"isnormal":0}"#,
        ).unwrap();
        fs::write(
            dir.join("water.json"),
            r#"{"word":"water","phonetic":"'wɔːtə","translation":"n. 水, 液体\nv. 浇水","definition":"","tags":[],"exchange":"","definitions":[],"isnormal":0}"#,
        ).unwrap();

        let dir_str = dir.to_string_lossy().to_string();
        let idx = build_index(&dir_str, None);
        assert_eq!(idx.records.len(), 3);

        let index_path = dir.join("index.bin");
        write_index(&idx, &index_path).unwrap();
        let loaded = read_index(&index_path, &dir_str).expect("index reloads");
        assert_eq!(loaded.records.len(), 3);
        let svc = DictionaryService {
            dictionary_path: dir_str.clone(),
            index_path: index_path.clone(),
            index: Some(loaded),
        };

        let apple = svc.search("苹果", "zh", 5);
        assert!(apple.iter().any(|w| w.word == "apple"), "got {:?}", apple.iter().map(|w| &w.word).collect::<Vec<_>>());
        let pretty = svc.search("漂亮", "zh", 5);
        assert!(pretty.iter().any(|w| w.word == "pretty"));
        let water = svc.search("水", "zh", 5);
        assert!(water.iter().any(|w| w.word == "water"));

        let detail = svc.get_word("apple").expect("apple detail");
        assert_eq!(detail.phonetic, "'æpl");
        assert!(!detail.definitions.is_empty());
        assert!(svc.get_word("missing").is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    /// ECDICT rows with isnormal = 0 only carry a translation (and optionally an
    /// English definition). They must still open as normal definition cards.
    #[test]
    fn ecdict_isnormal_zero_keeps_basic_definitions() {
        // Double-escaped separators, exactly as the real dict_json files store them.
        let raw = r#"{"word":"'hood","phonetic":"hʊd","translation":"n. 罩；风帽\\nv. 覆盖；用头巾包\\n[网络] 兜帽","definition":"","tags":[],"exchange":"","definitions":[],"isnormal":0}"#;
        let n = normalize_entry(serde_json::from_str::<WordDefinition>(raw).unwrap());
        assert_eq!(n.definitions.len(), 3, "translation lines become cards");
        assert_eq!(n.definitions[0].pos, "n.");
        assert!(n.definitions[0].explanation_cn.contains("风帽"));
        assert_eq!(n.definitions[1].pos, "v.");
        assert_eq!(n.definitions[2].pos, "[网络]");
        assert!(n.definitions[0].explanation_en.is_empty());
        assert!(!n.concise_definition.contains("\\n"), "concise must not keep the literal escape");
        assert!(n.concise_definition.starts_with("n. 罩"));

        // English-only rows (no translation at all) still show something.
        let raw = r#"{"word":"aa","translation":"","definition":"n. a dry form of lava","isnormal":0}"#;
        let n = normalize_entry(serde_json::from_str::<WordDefinition>(raw).unwrap());
        assert_eq!(n.definitions.len(), 1);
        assert!(n.definitions[0].explanation_en.contains("lava"));
        assert!(n.definitions[0].explanation_cn.is_empty());
    }

    #[test]
    fn json_file_names_stay_unique_and_windows_safe() {
        assert_eq!(json_file_name("apple"), "apple.json");
        assert_eq!(json_file_name(""), "word.json");
        // Sanitised names get a stable hash so different words never collide.
        let hood = json_file_name("'hood");
        let dash = json_file_name("-hood");
        assert!(hood.starts_with("hood_") && hood.ends_with(".json"), "{hood}");
        assert!(dash.starts_with("hood_") && dash.ends_with(".json"), "{dash}");
        assert_ne!(hood, dash);
        assert!(json_file_name("A/B").starts_with("a_b_"));
        // Device names are invalid on Windows even with an extension.
        assert!(json_file_name("con").starts_with("con_"));
        assert!(json_file_name("NUL").starts_with("nul_"));
        assert!(json_file_name("com1").starts_with("com1_"));
    }

    /// "Random word" only draws from full entries (isnormal = 1), so it never
    /// lands on a translation-only stub and only reads one file per call.
    #[test]
    fn random_word_prefers_full_entries() {
        let dir = std::env::temp_dir().join("edict-random-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let full = r#"{"word":"apple","translation":"n. 苹果","definition":"n. fruit",
            "definitions":[{"pos":"noun","explanation_en":"A fruit.","explanation_cn":"苹果。",
            "example_en":"I ate an apple.","example_cn":"我吃了一个苹果。"}],"isnormal":1}"#;
        fs::write(dir.join("apple.json"), full).unwrap();
        for name in ["'hood", "aa", "zzz"] {
            fs::write(
                dir.join(format!("{name}.json")),
                format!(r#"{{"word":"{name}","translation":"n. 测试","isnormal":0}}"#),
            ).unwrap();
        }

        let dir_str = dir.to_string_lossy().to_string();
        let idx = build_index(&dir_str, None);
        assert_eq!(idx.records.len(), 4);
        let svc = DictionaryService {
            dictionary_path: dir_str.clone(),
            index_path: dir.join("index.bin"),
            index: Some(idx),
        };
        for _ in 0..16 {
            let w = svc.get_random_word().expect("a random word");
            assert_eq!(w.word, "apple", "only the isnormal = 1 entry is eligible");
            assert!(!w.definitions[0].example_en.is_empty());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Opt-in full build: point EDICT_TEST_DICT at an extracted dict_json
    /// directory. Ignored by default; nothing machine-specific is baked in.
    #[test]
    #[ignore]
    fn build_full_ecdict_index_when_available() {
        let dir = match std::env::var("EDICT_TEST_DICT") {
            Ok(d) if Path::new(&d).is_dir() => d,
            _ => {
                println!("EDICT_TEST_DICT is not set to an existing directory; skipping");
                return;
            }
        };
        let started = std::time::Instant::now();
        let idx = build_index(&dir, Some(&|n| {
            if n % 50_000 == 0 { println!("indexed {n}"); }
        }));
        println!("built {} entries in {:?}", idx.records.len(), started.elapsed());
        let expected_min: usize = std::env::var("EDICT_TEST_MIN")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(700_000);
        assert!(idx.records.len() >= expected_min, "expected at least {expected_min} entries");

        let index_path = std::env::temp_dir().join("edict-full-index.bin");
        let start_save = std::time::Instant::now();
        write_index(&idx, &index_path).unwrap();
        println!("saved index in {:?}", start_save.elapsed());
        let start_load = std::time::Instant::now();
        let loaded = read_index(&index_path, &dir).expect("index reloads");
        println!("loaded index in {:?}", start_load.elapsed());

        let svc = DictionaryService {
            dictionary_path: dir.clone(),
            index_path,
            index: Some(loaded),
        };
        for q in ["苹果", "漂亮", "水", "量子纠缠"] {
            let t = std::time::Instant::now();
            let r = svc.search(q, "zh", 8);
            println!("{q} -> {:?} in {:?}", r.iter().map(|w| &w.word).collect::<Vec<_>>(), t.elapsed());
        }
        for q in ["apple", "app", "flu"] {
            let t = std::time::Instant::now();
            let r = svc.search(q, "en", 8);
            println!("{q} -> {:?} in {:?}", r.iter().map(|w| &w.word).collect::<Vec<_>>(), t.elapsed());
        }
        let t = std::time::Instant::now();
        let detail = svc.get_word("apple");
        println!("get_word apple in {:?}: {:?}", t.elapsed(), detail.map(|d| (d.phonetic, d.definitions.len())));

        let normal = idx.records.iter().filter(|r| r.tag_mask & NORMAL_BIT != 0).count();
        println!("normal (isnormal=1) entries: {normal} / {}", idx.records.len());

        // A translation-only entry must still open with usable definitions.
        if let Some(i) = (0..idx.records.len()).find(|i| idx.records[*i].tag_mask & NORMAL_BIT == 0) {
            let t = std::time::Instant::now();
            if let Some(d) = svc.read_entry(i) {
                println!(
                    "isnormal=0 sample {:?} in {:?}: concise={:?} cards={} first_cn={:?} first_en={:?}",
                    d.word,
                    t.elapsed(),
                    d.concise_definition,
                    d.definitions.len(),
                    d.definitions.first().map(|x| &x.explanation_cn),
                    d.definitions.first().map(|x| &x.explanation_en),
                );
            }
        }

        let t = std::time::Instant::now();
        let mut words = Vec::new();
        for _ in 0..5 {
            if let Some(w) = svc.get_random_word() {
                words.push(w.word);
            }
        }
        println!("5 random words in {:?}: {:?}", t.elapsed(), words);
    }
}
