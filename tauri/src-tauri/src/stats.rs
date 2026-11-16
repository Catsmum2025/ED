//! Query statistics - port of electron/services/stats.ts (stats.json).

use std::collections::HashMap;
use std::fs;

use chrono::{Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state;
use crate::AppState;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QueryRecord {
    pub word: String,
    pub lang: String,
    pub query_count: u64,
    pub first_queried_at: u64,
    pub last_queried_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsOverview {
    pub learned: usize,
    pub total_queries: u64,
    pub top_word: String,
}

#[derive(Serialize)]
pub struct HeatmapData {
    pub date: String,
    pub count: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopWord {
    pub word: String,
    pub query_count: u64,
    pub last_queried_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct StatsService {
    records: HashMap<String, QueryRecord>,
}

impl StatsService {
    pub fn new() -> Self {
        let mut svc = Self { records: HashMap::new() };
        svc.load();
        svc
    }

    fn load(&mut self) {
        let path = state::stats_file();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<Vec<QueryRecord>>(&raw) {
                self.records = parsed.into_iter().map(|r| (r.word.clone(), r)).collect();
            }
        }
    }

    fn save(&self) {
        let path = state::stats_file();
        if let Ok(json) = serde_json::to_string_pretty(
            &self.records.values().collect::<Vec<_>>(),
        ) {
            let _ = fs::write(path, json);
        }
    }

    pub fn record(&mut self, word: &str, lang: &str) {
        let now = now_ms();
        let entry = self.records.entry(word.to_string()).or_insert_with(|| QueryRecord {
            word: word.to_string(),
            lang: lang.to_string(),
            query_count: 0,
            first_queried_at: now,
            last_queried_at: now,
        });
        entry.query_count += 1;
        entry.last_queried_at = now;
        entry.lang = lang.to_string();
        self.save();
    }

    pub fn overview(&self) -> StatsOverview {
        let mut total_queries = 0u64;
        let mut top_word = "-".to_string();
        let mut top_count = 0u64;
        for r in self.records.values() {
            total_queries += r.query_count;
            if r.query_count > top_count {
                top_count = r.query_count;
                top_word = r.word.clone();
            }
        }
        StatsOverview { learned: self.records.len(), total_queries, top_word }
    }

    pub fn heatmap(&self, range: &str) -> Vec<HeatmapData> {
        let mut counts: HashMap<String, u64> = HashMap::new();
        for r in self.records.values() {
            let key = date_key(r.last_queried_at, range);
            *counts.entry(key).or_insert(0) += r.query_count;
        }
        if range == "total" {
            let total = counts.values().sum();
            return vec![HeatmapData { date: "总计".into(), count: total }];
        }
        let mut out: Vec<HeatmapData> = counts
            .into_iter()
            .map(|(date, count)| HeatmapData { date, count })
            .collect();
        out.sort_by(|a, b| a.date.cmp(&b.date));
        out
    }

    pub fn top_words(&self, limit: usize) -> Vec<TopWord> {
        let mut all: Vec<&QueryRecord> = self.records.values().collect();
        all.sort_by(|a, b| {
            b.query_count.cmp(&a.query_count).then_with(|| b.last_queried_at.cmp(&a.last_queried_at))
        });
        all.into_iter()
            .take(limit)
            .map(|r| TopWord {
                word: r.word.clone(),
                query_count: r.query_count,
                last_queried_at: r.last_queried_at,
            })
            .collect()
    }

    pub fn delete_word(&mut self, word: &str) {
        self.records.remove(word);
        self.save();
    }

    pub fn export_txt(&self, kind: &str) -> String {
        let mut all: Vec<&QueryRecord> = self.records.values().collect();
        if kind == "learned" {
            all.sort_by(|a, b| a.word.cmp(&b.word));
            let mut out = String::from("单词\t查询次数\t最后查询时间");
            for r in all {
                let dt = Local.timestamp_millis_opt(r.last_queried_at as i64).single();
                let time = match dt {
                    Some(d) => d.format("%Y/%m/%d %H:%M:%S").to_string(),
                    None => String::new(),
                };
                out.push_str(&format!("\n{}\t{}\t{}", r.word, r.query_count, time));
            }
            out
        } else {
            all.sort_by(|a, b| b.query_count.cmp(&a.query_count));
            let mut out = String::from("单词\t查询次数");
            for r in all {
                out.push_str(&format!("\n{}\t{}", r.word, r.query_count));
            }
            out
        }
    }
}

/// Bucket key for heatmap grouping (daily / weekly(Monday) / monthly / yearly).
fn date_key(millis: u64, range: &str) -> String {
    let dt = match Local.timestamp_millis_opt(millis as i64).single() {
        Some(d) => d,
        None => return String::new(),
    };
    match range {
        "weekly" => {
            use chrono::Weekday;
            let num_from_mon = match dt.weekday() {
                Weekday::Mon => 0, Weekday::Tue => 1, Weekday::Wed => 2, Weekday::Thu => 3,
                Weekday::Fri => 4, Weekday::Sat => 5, Weekday::Sun => 6,
            };
            let monday = dt.date_naive().overflowing_sub_days(chrono::Days::new(num_from_mon as u64)).0;
            format!("{:04}-{:02}-{:02}", monday.year(), monday.month(), monday.day())
        }
        "monthly" => format!("{:04}-{:02}", dt.year(), dt.month()),
        "yearly" => format!("{}", dt.year()),
        _ => format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day()),
    }
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn stats_record(app_state: State<'_, AppState>, word: String, lang: String) {
    app_state.stats.lock().unwrap().record(&word, &lang);
}

#[tauri::command]
pub fn stats_overview(app_state: State<'_, AppState>) -> StatsOverview {
    app_state.stats.lock().unwrap().overview()
}

#[tauri::command]
pub fn stats_heatmap(app_state: State<'_, AppState>, range: String) -> Vec<HeatmapData> {
    app_state.stats.lock().unwrap().heatmap(&range)
}

#[tauri::command]
pub fn stats_top_words(app_state: State<'_, AppState>, limit: Option<usize>) -> Vec<TopWord> {
    app_state.stats.lock().unwrap().top_words(limit.unwrap_or(50))
}

#[tauri::command]
pub fn stats_delete_word(app_state: State<'_, AppState>, word: String) {
    app_state.stats.lock().unwrap().delete_word(&word);
}

#[tauri::command]
pub fn stats_write_export(app_state: State<'_, AppState>, r#type: String, path: String) -> Result<(), String> {
    let content = app_state.stats.lock().unwrap().export_txt(&r#type);
    fs::write(&path, content).map_err(|e| e.to_string())
}
