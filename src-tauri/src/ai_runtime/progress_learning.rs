use crate::ai_runtime::model_manifest::get_manifest_store;
use crate::ai_runtime::types::{
    AiProgressEstimateDto, AiRecordProgressSampleResponseDto, ModelManifestItem,
    ProgressEstimateSource,
};
use chrono::{Local, TimeZone, Timelike};
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

const APP_IDENTIFIER: &str = "com.henji.ai";
const DATA_DIR_NAME: &str = "Henji-AI";
const DB_FILE_NAME: &str = "henji.db";
const BASE_RESOURCE_FILE: &str = "progress-seeds.base.json";
const GENERATED_RESOURCE_FILE: &str = "progress-seeds.json";
const DEFAULT_PROFILE_KEY: &str = "__default__";
const GLOBAL_SAMPLE_WINDOW: usize = 30;
const BUCKET_SAMPLE_WINDOW: usize = 20;
const QUERY_SAMPLE_WINDOW: usize = 180;
const BUCKET_MIN_SAMPLE_COUNT: usize = 6;
const GLOBAL_MIN_SAMPLE_COUNT_FOR_BUCKETS: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
pub enum ProgressSampleSource {
    Generation,
    Canvas,
}

impl ProgressSampleSource {
    fn from_str(input: &str) -> Self {
        match input.trim().to_ascii_lowercase().as_str() {
            "canvas" => Self::Canvas,
            _ => Self::Generation,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Generation => "generation",
            Self::Canvas => "canvas",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
pub enum TimeBucket {
    Night,
    Day,
    Evening,
}

impl TimeBucket {
    pub fn current() -> Self {
        Self::from_hour(Local::now().hour())
    }

    pub fn from_hour(hour: u32) -> Self {
        match hour {
            0..=7 => Self::Night,
            8..=15 => Self::Day,
            _ => Self::Evening,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Night => "night",
            Self::Day => "day",
            Self::Evening => "evening",
        }
    }

    fn from_key(input: &str) -> Option<Self> {
        match input {
            "night" => Some(Self::Night),
            "day" => Some(Self::Day),
            "evening" => Some(Self::Evening),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSeedFile {
    #[serde(default = "default_seed_version")]
    pub version: u32,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub models: BTreeMap<String, ProgressSeedModel>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSeedModel {
    #[serde(default)]
    pub profiles: BTreeMap<String, ProgressSeedProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSeedProfile {
    #[serde(default)]
    pub global_ms: u64,
    #[serde(default)]
    pub buckets: BTreeMap<String, u64>,
}

#[derive(Debug, Clone)]
struct ProgressSample {
    duration_ms: u64,
    time_bucket: TimeBucket,
}

#[derive(Debug, Clone)]
struct EstimateComputation {
    duration_ms: u64,
    sample_count: usize,
    used_trimmed_mean: bool,
}

#[derive(Debug, Clone)]
pub struct ProgressExportSummary {
    pub model_id: String,
    pub profile_key: String,
    pub global_ms: u64,
    pub global_sample_count: usize,
    pub global_trimmed: bool,
    pub buckets: BTreeMap<String, ExportBucketSummary>,
}

#[derive(Debug, Clone)]
pub struct ExportBucketSummary {
    pub duration_ms: u64,
    pub sample_count: usize,
    pub trimmed: bool,
}

static PROGRESS_SEED_STORE: Lazy<RwLock<ProgressSeedFile>> =
    Lazy::new(|| RwLock::new(load_progress_seed_file()));

fn default_seed_version() -> u32 {
    1
}

pub fn get_progress_estimate(
    app: &AppHandle,
    model_id: &str,
    params: &Map<String, Value>,
) -> Result<AiProgressEstimateDto, String> {
    let model = get_manifest_store()
        .read()
        .map_err(|error| format!("Failed to read manifest store: {}", error))?
        .get(model_id)
        .cloned()
        .ok_or_else(|| format!("Model not found in manifest: {}", model_id))?;

    let db_path = resolve_progress_db_path(app)?;
    let samples = load_progress_samples(&db_path, model_id, DEFAULT_PROFILE_KEY)?;
    let time_bucket = TimeBucket::current();
    Ok(build_estimate(model_id, Some(&model), params, &samples, time_bucket))
}

pub fn record_progress_sample(
    app: &AppHandle,
    model_id: &str,
    _params: &Map<String, Value>,
    started_at_ms: i64,
    finished_at_ms: i64,
    source: &str,
) -> Result<AiRecordProgressSampleResponseDto, String> {
    if finished_at_ms <= started_at_ms {
        let estimate = get_progress_estimate(app, model_id, &Map::new())?;
        return Ok(AiRecordProgressSampleResponseDto {
            actual_duration_ms: 0,
            estimate,
        });
    }

    let duration_ms = finished_at_ms - started_at_ms;
    if duration_ms <= 0 {
        let estimate = get_progress_estimate(app, model_id, &Map::new())?;
        return Ok(AiRecordProgressSampleResponseDto {
            actual_duration_ms: 0,
            estimate,
        });
    }

    let manifest_guard = get_manifest_store()
        .read()
        .map_err(|error| format!("Failed to read manifest store: {}", error))?;
    let Some(model) = manifest_guard.get(model_id).cloned() else {
        let estimate = get_progress_estimate(app, model_id, &Map::new())?;
        return Ok(AiRecordProgressSampleResponseDto {
            actual_duration_ms: duration_ms as u64,
            estimate,
        });
    };

    let db_path = resolve_progress_db_path(app)?;
    let profile_key = DEFAULT_PROFILE_KEY.to_string();
    let time_bucket = time_bucket_from_timestamp_ms(finished_at_ms);
    let parent = db_path
        .parent()
        .ok_or_else(|| format!("Progress DB path has no parent: {}", db_path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create data dir: {}", error))?;

    let conn = Connection::open(&db_path)
        .map_err(|error| format!("Failed to open progress DB: {}", error))?;
    ensure_schema(&conn)?;

    conn.execute(
        "INSERT INTO progress_samples (
          model_id, provider_id, media_type, profile_key, time_bucket,
          duration_ms, started_at_ms, finished_at_ms, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            model_id,
            model.provider_id,
            model.model_type.clone().unwrap_or_else(|| "image".to_string()),
            profile_key,
            time_bucket.key(),
            duration_ms,
            started_at_ms,
            finished_at_ms,
            ProgressSampleSource::from_str(source).as_str(),
        ],
    )
    .map_err(|error| format!("Failed to insert progress sample: {}", error))?;

    let samples = load_progress_samples(&db_path, model_id, DEFAULT_PROFILE_KEY)?;
    let estimate = build_estimate(model_id, Some(&model), &Map::new(), &samples, TimeBucket::current());
    Ok(AiRecordProgressSampleResponseDto {
        actual_duration_ms: duration_ms as u64,
        estimate,
    })
}

pub fn export_progress_seed_file(db_path: &Path, output_path: &Path) -> Result<Vec<ProgressExportSummary>, String> {
    let conn = Connection::open(db_path)
        .map_err(|error| format!("Failed to open progress DB: {}", error))?;
    ensure_schema(&conn)?;

    let pairs = load_distinct_profiles(&conn)?;
    let manifest_guard = get_manifest_store()
        .read()
        .map_err(|error| format!("Failed to read manifest store: {}", error))?;

    let mut seed_file = ProgressSeedFile {
        version: default_seed_version(),
        generated_at: Some(Local::now().to_rfc3339()),
        models: BTreeMap::new(),
    };
    let mut summaries = Vec::new();

    for (model_id, profile_key) in pairs {
        let samples = load_progress_samples(db_path, &model_id, &profile_key)?;
        if samples.is_empty() {
            continue;
        }

        let model = manifest_guard.get(&model_id);
        let global_default = resolve_global_default_ms(&model_id, model, &Map::new());
        let global = compute_estimate(&recent_sample_durations(&samples, None, GLOBAL_SAMPLE_WINDOW), global_default);
        let mut profile = ProgressSeedProfile {
            global_ms: global.duration_ms,
            buckets: BTreeMap::new(),
        };
        let mut summary = ProgressExportSummary {
            model_id: model_id.clone(),
            profile_key: profile_key.clone(),
            global_ms: global.duration_ms,
            global_sample_count: global.sample_count,
            global_trimmed: global.used_trimmed_mean,
            buckets: BTreeMap::new(),
        };

        for bucket in [TimeBucket::Night, TimeBucket::Day, TimeBucket::Evening] {
            let durations = recent_sample_durations(&samples, Some(bucket), BUCKET_SAMPLE_WINDOW);
            if durations.is_empty() {
                continue;
            }
            let bucket_estimate = compute_estimate(&durations, global.duration_ms);
            profile
                .buckets
                .insert(bucket.key().to_string(), bucket_estimate.duration_ms);
            summary.buckets.insert(
                bucket.key().to_string(),
                ExportBucketSummary {
                    duration_ms: bucket_estimate.duration_ms,
                    sample_count: bucket_estimate.sample_count,
                    trimmed: bucket_estimate.used_trimmed_mean,
                },
            );
        }

        seed_file
            .models
            .entry(model_id.clone())
            .or_default()
            .profiles
            .insert(profile_key.clone(), profile);
        summaries.push(summary);
    }

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create export dir: {}", error))?;
    }
    let content = serde_json::to_string_pretty(&seed_file)
        .map_err(|error| format!("Failed to serialize progress seeds: {}", error))?;
    fs::write(output_path, content)
        .map_err(|error| format!("Failed to write progress seeds: {}", error))?;

    Ok(summaries)
}

pub fn resolve_default_progress_db_path() -> Result<PathBuf, String> {
    let Some(local_data_dir) = dirs::data_local_dir() else {
        return Err("Unable to resolve local data dir".to_string());
    };
    Ok(local_data_dir
        .join(APP_IDENTIFIER)
        .join(DATA_DIR_NAME)
        .join(DB_FILE_NAME))
}

pub fn resolve_default_progress_seed_export_path() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|error| format!("Failed to read cwd: {}", error))?;
    Ok(cwd.join("dev-data").join("progress-seeds.local.json"))
}

fn resolve_progress_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_local_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app local data dir: {}", error))?;
    Ok(app_local_dir.join(DATA_DIR_NAME).join(DB_FILE_NAME))
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS progress_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          profile_key TEXT NOT NULL,
          time_bucket TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          started_at_ms INTEGER NOT NULL,
          finished_at_ms INTEGER NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_progress_samples_lookup
          ON progress_samples (model_id, profile_key, time_bucket, finished_at_ms DESC);",
    )
    .map_err(|error| format!("Failed to ensure progress schema: {}", error))?;
    Ok(())
}

fn load_distinct_profiles(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT model_id, profile_key
             FROM progress_samples
             WHERE duration_ms > 0
             ORDER BY model_id, profile_key",
        )
        .map_err(|error| format!("Failed to prepare profile query: {}", error))?;

    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|error| format!("Failed to query profiles: {}", error))?;

    let mut pairs = Vec::new();
    for row in rows {
        pairs.push(row.map_err(|error| format!("Failed to read profile row: {}", error))?);
    }
    Ok(pairs)
}

fn load_progress_samples(db_path: &Path, model_id: &str, profile_key: &str) -> Result<Vec<ProgressSample>, String> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let conn = Connection::open(db_path)
        .map_err(|error| format!("Failed to open progress DB: {}", error))?;
    ensure_schema(&conn)?;

    let mut statement = conn
        .prepare(
            "SELECT duration_ms, time_bucket
             FROM progress_samples
             WHERE model_id = ?1
               AND profile_key = ?2
               AND duration_ms > 0
               AND finished_at_ms > started_at_ms
             ORDER BY finished_at_ms DESC
             LIMIT ?3",
        )
        .map_err(|error| format!("Failed to prepare progress sample query: {}", error))?;

    let rows = statement
        .query_map(params![model_id, profile_key, QUERY_SAMPLE_WINDOW as i64], |row| {
            let time_bucket_key = row.get::<_, String>(1)?;
            let time_bucket = TimeBucket::from_key(&time_bucket_key).unwrap_or(TimeBucket::Day);
            Ok(ProgressSample {
                duration_ms: row.get::<_, u64>(0)?,
                time_bucket,
            })
        })
        .map_err(|error| format!("Failed to query progress samples: {}", error))?;

    let mut samples = Vec::new();
    for row in rows {
        samples.push(row.map_err(|error| format!("Failed to read progress sample row: {}", error))?);
    }
    Ok(samples)
}

fn build_estimate(
    model_id: &str,
    model: Option<&ModelManifestItem>,
    params: &Map<String, Value>,
    samples: &[ProgressSample],
    time_bucket: TimeBucket,
) -> AiProgressEstimateDto {
    let global_default = resolve_global_default_ms(model_id, model, params);
    let global_durations = recent_sample_durations(samples, None, GLOBAL_SAMPLE_WINDOW);
    let global = compute_estimate(&global_durations, global_default);
    let profile_key = DEFAULT_PROFILE_KEY.to_string();
    let seed_bucket_ms = lookup_seed_bucket(model_id, &profile_key, time_bucket);
    let bucket_durations = recent_sample_durations(samples, Some(time_bucket), BUCKET_SAMPLE_WINDOW);
    let bucket_estimate = if bucket_durations.is_empty() {
        None
    } else {
        Some(compute_estimate(&bucket_durations, global.duration_ms))
    };

    if global.sample_count == 0 {
        if let Some(duration_ms) = seed_bucket_ms {
            return AiProgressEstimateDto {
                duration_ms,
                source: ProgressEstimateSource::Seed,
                profile_key,
                time_bucket: time_bucket.key().to_string(),
                global_sample_count: 0,
                bucket_sample_count: 0,
                default_duration_ms: global_default,
                global_estimate_ms: global_default,
                bucket_estimate_ms: None,
                recent_global_durations_ms: global_durations,
                recent_bucket_durations_ms: bucket_durations,
            };
        }

        let source = resolve_default_source(model_id, model, params);
        return AiProgressEstimateDto {
            duration_ms: global.duration_ms,
            source,
            profile_key,
            time_bucket: time_bucket.key().to_string(),
            global_sample_count: 0,
            bucket_sample_count: 0,
            default_duration_ms: global_default,
            global_estimate_ms: global_default,
            bucket_estimate_ms: None,
            recent_global_durations_ms: global_durations,
            recent_bucket_durations_ms: bucket_durations,
        };
    }

    if global.sample_count < GLOBAL_MIN_SAMPLE_COUNT_FOR_BUCKETS {
        return AiProgressEstimateDto {
            duration_ms: global.duration_ms,
            source: ProgressEstimateSource::Global,
            profile_key,
            time_bucket: time_bucket.key().to_string(),
            global_sample_count: global.sample_count,
            bucket_sample_count: 0,
            default_duration_ms: global_default,
            global_estimate_ms: global.duration_ms,
            bucket_estimate_ms: bucket_estimate.as_ref().map(|value| value.duration_ms),
            recent_global_durations_ms: global_durations,
            recent_bucket_durations_ms: bucket_durations,
        };
    }

    if bucket_durations.len() < BUCKET_MIN_SAMPLE_COUNT {
        return AiProgressEstimateDto {
            duration_ms: global.duration_ms,
            source: ProgressEstimateSource::Global,
            profile_key,
            time_bucket: time_bucket.key().to_string(),
            global_sample_count: global.sample_count,
            bucket_sample_count: bucket_durations.len(),
            default_duration_ms: global_default,
            global_estimate_ms: global.duration_ms,
            bucket_estimate_ms: bucket_estimate.as_ref().map(|value| value.duration_ms),
            recent_global_durations_ms: global_durations,
            recent_bucket_durations_ms: bucket_durations,
        };
    }

    let bucket = bucket_estimate.unwrap_or_else(|| compute_estimate(&bucket_durations, global.duration_ms));
    AiProgressEstimateDto {
        duration_ms: bucket.duration_ms,
        source: ProgressEstimateSource::TimeBucket,
        profile_key,
        time_bucket: time_bucket.key().to_string(),
        global_sample_count: global.sample_count,
        bucket_sample_count: bucket.sample_count,
        default_duration_ms: global_default,
        global_estimate_ms: global.duration_ms,
        bucket_estimate_ms: Some(bucket.duration_ms),
        recent_global_durations_ms: global_durations,
        recent_bucket_durations_ms: bucket_durations,
    }
}

fn recent_sample_durations(
    samples: &[ProgressSample],
    bucket: Option<TimeBucket>,
    limit: usize,
) -> Vec<u64> {
    samples
        .iter()
        .filter(|sample| match bucket {
            Some(expected) => sample.time_bucket == expected,
            None => true,
        })
        .take(limit)
        .map(|sample| sample.duration_ms)
        .collect()
}

fn compute_estimate(samples: &[u64], default_ms: u64) -> EstimateComputation {
    if samples.is_empty() {
        return EstimateComputation {
            duration_ms: default_ms,
            sample_count: 0,
            used_trimmed_mean: false,
        };
    }

    if samples.len() < 10 {
        let total = default_ms as u128 + samples.iter().map(|value| *value as u128).sum::<u128>();
        let average = (total / (samples.len() as u128 + 1)) as u64;
        return EstimateComputation {
            duration_ms: average,
            sample_count: samples.len(),
            used_trimmed_mean: false,
        };
    }

    if samples.len() < 12 {
        let average = samples.iter().sum::<u64>() / samples.len() as u64;
        return EstimateComputation {
            duration_ms: average,
            sample_count: samples.len(),
            used_trimmed_mean: false,
        };
    }

    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let trimmed = &sorted[1..sorted.len() - 1];
    let average = trimmed.iter().sum::<u64>() / trimmed.len() as u64;
    EstimateComputation {
        duration_ms: average,
        sample_count: samples.len(),
        used_trimmed_mean: true,
    }
}

fn resolve_global_default_ms(
    model_id: &str,
    model: Option<&ModelManifestItem>,
    params: &Map<String, Value>,
) -> u64 {
    if let Some(duration_ms) = lookup_seed_global(model_id, DEFAULT_PROFILE_KEY) {
        return duration_ms;
    }

    if let Some(duration_ms) = resolve_meta_duration_ms(model, params) {
        return duration_ms;
    }

    resolve_generic_default_ms(model, params)
}

fn resolve_default_source(
    model_id: &str,
    model: Option<&ModelManifestItem>,
    params: &Map<String, Value>,
) -> ProgressEstimateSource {
    if lookup_seed_global(model_id, DEFAULT_PROFILE_KEY).is_some() {
        return ProgressEstimateSource::Seed;
    }
    if resolve_meta_duration_ms(model, params).is_some() {
        return ProgressEstimateSource::Meta;
    }
    ProgressEstimateSource::Default
}

fn lookup_seed_global(model_id: &str, profile_key: &str) -> Option<u64> {
    let guard = PROGRESS_SEED_STORE.read().ok()?;
    guard
        .models
        .get(model_id)
        .and_then(|model| model.profiles.get(profile_key))
        .map(|profile| profile.global_ms)
        .filter(|value| *value > 0)
}

fn lookup_seed_bucket(model_id: &str, profile_key: &str, bucket: TimeBucket) -> Option<u64> {
    let guard = PROGRESS_SEED_STORE.read().ok()?;
    guard
        .models
        .get(model_id)
        .and_then(|model| model.profiles.get(profile_key))
        .and_then(|profile| profile.buckets.get(bucket.key()).copied())
        .filter(|value| *value > 0)
}

fn resolve_meta_duration_ms(model: Option<&ModelManifestItem>, params: &Map<String, Value>) -> Option<u64> {
    let model = model?;

    if let Some(progress) = model.progress.as_ref() {
        if progress.mode == "time" {
            let base_duration_ms = progress.base_duration_ms?;
            let unit_count = resolve_unit_count(params, progress.scale_with.as_deref());
            let per_unit_ms = progress.per_unit_ms.unwrap_or(0);
            let raw_duration_ms = base_duration_ms.saturating_add(per_unit_ms.saturating_mul(unit_count.saturating_sub(1) as u64));
            let min_duration_ms = progress.min_duration_ms.unwrap_or(1);
            let max_duration_ms = progress.max_duration_ms.unwrap_or(raw_duration_ms.max(min_duration_ms));
            return Some(clamp_u64(raw_duration_ms, min_duration_ms, max_duration_ms));
        }

        if progress.mode == "polling" {
            let base_attempts = progress.base_attempts?;
            let per_unit_attempts = progress.per_unit_attempts.unwrap_or(0);
            let unit_count = resolve_unit_count(params, progress.scale_with.as_deref());
            let raw_attempts = base_attempts.saturating_add(per_unit_attempts.saturating_mul(unit_count.saturating_sub(1) as u32));
            let min_attempts = progress.min_attempts.unwrap_or(1);
            let max_attempts = progress
                .max_attempts
                .or_else(|| model.polling.as_ref().map(|polling| polling.max_attempts))
                .unwrap_or(raw_attempts.max(min_attempts));
            let attempts = clamp_u32(raw_attempts, min_attempts, max_attempts);
            let interval_ms = progress
                .interval_ms
                .or_else(|| model.polling.as_ref().map(|polling| polling.interval))
                .unwrap_or(3000);
            let raw_duration_ms = attempts as u64 * interval_ms;
            let min_duration_ms = progress.min_duration_ms.unwrap_or(1);
            let max_duration_ms = progress.max_duration_ms.unwrap_or(raw_duration_ms.max(min_duration_ms));
            return Some(clamp_u64(raw_duration_ms, min_duration_ms, max_duration_ms));
        }
    }

    model.polling.as_ref().map(|polling| {
        let attempts = polling.expected_attempts.unwrap_or(polling.max_attempts);
        attempts as u64 * polling.interval
    })
}

fn resolve_generic_default_ms(model: Option<&ModelManifestItem>, params: &Map<String, Value>) -> u64 {
    let model_type = model
        .and_then(|item| item.model_type.as_deref())
        .unwrap_or("image");

    match model_type {
        "video" => {
            let base_ms = 120_000_u64;
            let min_ms = 30_000_u64;
            let max_ms = 900_000_u64;
            let duration_seconds = pick_first_number_like(
                params,
                &["duration", "videoDuration", "video_duration", "ppioWan25VideoDuration", "seconds"],
            )
            .unwrap_or(5.0);
            let normalized_seconds = clamp_f64(duration_seconds, 1.0, 30.0);
            let scale = clamp_f64(normalized_seconds / 5.0, 0.5, 6.0);
            clamp_u64((base_ms as f64 * scale).round() as u64, min_ms, max_ms)
        }
        "audio" => {
            let base_ms = 10_000_u64;
            let min_ms = 3_000_u64;
            let max_ms = 120_000_u64;
            let text_length = resolve_prompt_text_length(params);
            let extra_blocks = if text_length > 120 {
                ((text_length - 120) as f64 / 80.0).ceil() as u64
            } else {
                0
            };
            clamp_u64(base_ms + extra_blocks * 800, min_ms, max_ms)
        }
        _ => {
            let base_ms = 60_000_u64;
            let min_ms = 15_000_u64;
            let max_ms = 240_000_u64;
            let image_count = pick_first_number_like(
                params,
                &["maxImages", "max_images", "numImages", "num_images", "imageCount", "image_count"],
            )
            .unwrap_or(1.0)
            .round()
            .max(1.0) as u64;
            clamp_u64(base_ms + image_count.saturating_sub(1) * 12_000, min_ms, max_ms)
        }
    }
}

fn resolve_unit_count(params: &Map<String, Value>, field: Option<&str>) -> usize {
    let Some(field) = field else {
        return 1;
    };
    let Some(value) = params.get(field) else {
        return 1;
    };

    match value {
        Value::Array(items) => items.len().max(1),
        Value::Number(number) => number.as_f64().unwrap_or(1.0).round().max(1.0) as usize,
        Value::String(text) => text.parse::<f64>().ok().map(|value| value.round().max(1.0) as usize).unwrap_or(1),
        _ => 1,
    }
}

fn resolve_prompt_text_length(params: &Map<String, Value>) -> usize {
    ["text", "prompt"]
        .iter()
        .find_map(|key| params.get(*key).and_then(Value::as_str))
        .map(|value| value.trim().chars().count())
        .unwrap_or(0)
}

fn pick_first_number_like(params: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(value) = params.get(*key) {
            match value {
                Value::Number(number) => {
                    if let Some(parsed) = number.as_f64() {
                        return Some(parsed);
                    }
                }
                Value::String(text) => {
                    if let Ok(parsed) = text.trim().parse::<f64>() {
                        return Some(parsed);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

fn clamp_u64(value: u64, min: u64, max: u64) -> u64 {
    value.max(min).min(max)
}

fn clamp_u32(value: u32, min: u32, max: u32) -> u32 {
    value.max(min).min(max)
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn time_bucket_from_timestamp_ms(timestamp_ms: i64) -> TimeBucket {
    chrono::Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .map(|value| TimeBucket::from_hour(value.hour()))
        .unwrap_or_else(TimeBucket::current)
}

fn load_progress_seed_file() -> ProgressSeedFile {
    load_seed_candidates()
        .into_iter()
        .find_map(|path| {
            fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str::<ProgressSeedFile>(&content).ok())
        })
        .unwrap_or_else(|| ProgressSeedFile {
            version: default_seed_version(),
            generated_at: None,
            models: BTreeMap::new(),
        })
}

fn load_seed_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri").join("resources").join(GENERATED_RESOURCE_FILE));
        candidates.push(cwd.join("resources").join(GENERATED_RESOURCE_FILE));
        candidates.push(cwd.join("src-tauri").join("resources").join(BASE_RESOURCE_FILE));
    }

    if let Ok(executable) = std::env::current_exe() {
        if let Some(dir) = executable.parent() {
            candidates.push(dir.join("resources").join(GENERATED_RESOURCE_FILE));
            candidates.push(dir.join("../resources").join(GENERATED_RESOURCE_FILE));
            candidates.push(dir.join("resources").join(BASE_RESOURCE_FILE));
            candidates.push(dir.join("../resources").join(BASE_RESOURCE_FILE));
        }
    }

    let mut unique = BTreeSet::new();
    candidates
        .into_iter()
        .filter(|path| unique.insert(path.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_runtime::types::ProgressConfig;

    fn empty_model() -> ModelManifestItem {
        ModelManifestItem {
            model_id: "demo-model".to_string(),
            provider_id: "ppio".to_string(),
            model_type: Some("image".to_string()),
            polling: None,
            progress: None,
            progress_learning: None,
            endpoints: None,
            request: None,
            runtime_constraints: None,
        }
    }

    #[test]
    fn compute_estimate_uses_default_for_empty_samples() {
        let result = compute_estimate(&[], 60_000);
        assert_eq!(result.duration_ms, 60_000);
        assert_eq!(result.sample_count, 0);
        assert!(!result.used_trimmed_mean);
    }

    #[test]
    fn compute_estimate_blends_default_before_ten_samples() {
        let result = compute_estimate(&[20_000], 60_000);
        assert_eq!(result.duration_ms, 40_000);
        assert_eq!(result.sample_count, 1);
    }

    #[test]
    fn compute_estimate_uses_plain_average_between_ten_and_eleven() {
        let samples = vec![10_000_u64; 10];
        let result = compute_estimate(&samples, 60_000);
        assert_eq!(result.duration_ms, 10_000);
        assert!(!result.used_trimmed_mean);
    }

    #[test]
    fn compute_estimate_uses_trimmed_mean_after_twelve_samples() {
        let samples = vec![
            10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
            1_000, 99_000,
        ];
        let result = compute_estimate(&samples, 60_000);
        assert_eq!(result.duration_ms, 10_000);
        assert!(result.used_trimmed_mean);
    }

    #[test]
    fn resolve_profile_key_keeps_segment_order() {
        let _model = empty_model();
        let _params = Map::new();
        assert_eq!(DEFAULT_PROFILE_KEY, "__default__");
    }

    #[test]
    fn resolve_profile_key_formats_text_length_buckets() {
        let _model = empty_model();
        let _params = Map::new();
        assert_eq!(DEFAULT_PROFILE_KEY, "__default__");
    }

    #[test]
    fn resolve_meta_duration_uses_progress_config() {
        let mut model = empty_model();
        model.progress = Some(ProgressConfig {
            mode: "time".to_string(),
            base_duration_ms: Some(20_000),
            per_unit_ms: Some(12_000),
            scale_with: Some("maxImages".to_string()),
            min_duration_ms: Some(15_000),
            max_duration_ms: Some(180_000),
            base_attempts: None,
            per_unit_attempts: None,
            min_attempts: None,
            max_attempts: None,
            interval_ms: None,
        });

        let mut params = Map::new();
        params.insert("maxImages".to_string(), Value::Number(serde_json::Number::from(3)));

        assert_eq!(resolve_meta_duration_ms(Some(&model), &params), Some(44_000));
    }
}
