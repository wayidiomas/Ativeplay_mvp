use anyhow::{Context, Result, bail, anyhow};
use async_stream::stream;
use futures::Stream;
use lazy_static::lazy_static;
use regex::Regex;
use reqwest::{Client, Response};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::pin::Pin;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::sleep;
use tokio_stream::StreamExt;
use tokio_util::io::StreamReader;

use crate::models::{
    CacheMetadata, MediaKind, PlaylistGroup, PlaylistItem, PlaylistStats,
    SeasonData, SeriesEpisode, SeriesInfo,
};
use crate::services::cache::CacheService;
use crate::services::classifier::ContentClassifier;
use crate::services::db_cache::DbCacheService;

/// Series Run for RLE (Run-Length Encoding) optimization
/// Accumulates consecutive episodes of the same series
#[derive(Debug)]
struct SeriesRun {
    series_key: String,
    series_name: String,
    group: String,
    logo: Option<String>,
    year: Option<u16>,
    quality: Option<String>,
    episodes: Vec<SeriesRunEpisode>,
}

#[derive(Debug, Clone)]
struct SeriesRunEpisode {
    item_id: String,
    name: String,
    season: u8,
    episode: u16,
    url: String,
}

/// Accumulated series data during parsing
#[derive(Debug)]
struct SeriesAccumulator {
    id: String,
    name: String,
    group: String,
    logo: Option<String>,
    year: Option<u16>,
    quality: Option<String>,
    episodes: Vec<SeriesRunEpisode>,
}

// Defensive limits for streamed parsing
const MAX_LINE_BYTES: usize = 32 * 1024; // protect against maliciously long lines
const READ_LINE_TIMEOUT: Duration = Duration::from_secs(10);

/// Batch size for streaming writes (flush to disk every N items)
const STREAMING_BATCH_SIZE: usize = 500;

lazy_static! {
    /// Regex to normalize multiple whitespaces into single space
    static ref MULTI_SPACE_REGEX: Regex = Regex::new(r"\s{2,}").unwrap();
    /// Regex to parse EXTINF attributes (tvg-id="...", group-title="...", etc)
    static ref ATTR_REGEX: Regex = Regex::new(r#"(\w+(?:-\w+)*)="([^"]*)""#).unwrap();

    /// Regex to extract duration from EXTINF line
    static ref DURATION_REGEX: Regex = Regex::new(r"^-?\d+").unwrap();
}

/// Parsed EXTINF line data
#[derive(Debug, Default)]
struct ExtinfData {
    _duration: i32,
    attributes: HashMap<String, String>,
    title: String,
}

/// Generate a unique item ID based on URL and index
fn generate_item_id(url: &str, index: usize) -> String {
    let hash: i32 = url.chars().fold(0, |acc, c| {
        ((acc << 5).wrapping_sub(acc)).wrapping_add(c as i32)
    });
    format!("item_{}_{}", hash.unsigned_abs(), index)
}

/// Parse an EXTINF line
/// Format: #EXTINF:duration tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Title
fn parse_extinf(line: &str) -> Option<ExtinfData> {
    if !line.starts_with("#EXTINF:") {
        return None;
    }

    let content = &line[8..]; // Remove "#EXTINF:"

    // Find first comma separating header from title
    let first_comma = content.find(',')?;

    let header = &content[..first_comma];
    let title = content[first_comma + 1..].trim().to_string();

    // Parse duration
    let duration = DURATION_REGEX
        .find(header)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(-1);

    // Parse attributes
    let mut attributes = HashMap::new();
    for caps in ATTR_REGEX.captures_iter(header) {
        let key = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        let value = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
        attributes.insert(key, value);
    }

    Some(ExtinfData {
        _duration: duration,
        attributes,
        title,
    })
}

/// Generate SHA1 hash of URL for cache key
pub fn hash_url(url: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(url.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", result)
}

/// Normalize text: trim and collapse multiple spaces into single space
/// Like the JS parser's normalize option
fn normalize_text(text: &str) -> String {
    let trimmed = text.trim();
    MULTI_SPACE_REGEX.replace_all(trimmed, " ").to_string()
}

/// Generate URL hash for deduplication (shorter than full SHA1)
fn url_dedup_hash(url: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    hasher.finish()
}

/// Flush a series run to the accumulator
/// This merges episodes from consecutive runs of the same series
fn flush_run_to_accumulator(
    accum: &mut HashMap<String, SeriesAccumulator>,
    run: SeriesRun,
) {
    if run.episodes.is_empty() {
        return;
    }

    let series_id = format!("series_{}", hash_url(&run.series_key));

    let entry = accum.entry(run.series_key.clone()).or_insert_with(|| SeriesAccumulator {
        id: series_id,
        name: run.series_name.clone(),
        group: run.group.clone(),
        logo: run.logo.clone(),
        year: run.year,
        quality: run.quality.clone(),
        episodes: Vec::new(),
    });

    // Merge episodes from this run
    entry.episodes.extend(run.episodes);
}

/// Build SeriesInfo from accumulator with episodes sorted by season/episode
fn build_series_info(accum: SeriesAccumulator) -> SeriesInfo {
    let mut episodes = accum.episodes;

    // Sort episodes by season, then by episode
    episodes.sort_by(|a, b| {
        match a.season.cmp(&b.season) {
            std::cmp::Ordering::Equal => a.episode.cmp(&b.episode),
            other => other,
        }
    });

    // Group episodes by season
    let mut seasons_map: HashMap<u8, Vec<SeriesEpisode>> = HashMap::new();
    for ep in &episodes {
        seasons_map
            .entry(ep.season)
            .or_insert_with(Vec::new)
            .push(SeriesEpisode {
                item_id: ep.item_id.clone(),
                season: ep.season,
                episode: ep.episode,
                name: ep.name.clone(),
                url: ep.url.clone(),
            });
    }

    // Convert to sorted SeasonData
    let mut seasons_data: Vec<SeasonData> = seasons_map
        .into_iter()
        .map(|(season_num, mut eps)| {
            // Sort episodes within season
            eps.sort_by_key(|e| e.episode);
            SeasonData {
                season_number: season_num,
                episodes: eps,
            }
        })
        .collect();

    // Sort seasons
    seasons_data.sort_by_key(|s| s.season_number);

    // Calculate stats
    let total_episodes = episodes.len();
    let total_seasons = seasons_data.len();
    let first_season = seasons_data.first().map(|s| s.season_number as u16).unwrap_or(0);
    let last_season = seasons_data.last().map(|s| s.season_number as u16).unwrap_or(0);

    SeriesInfo {
        id: accum.id,
        name: accum.name,
        logo: accum.logo,
        group: accum.group,
        total_episodes,
        total_seasons,
        first_season,
        last_season,
        year: accum.year,
        quality: accum.quality,
        seasons_data: Some(seasons_data),
    }
}

/// M3U Parser service for streaming playlist parsing
pub struct M3UParser {
    client: Client,
    cache: CacheService,
    db_cache: DbCacheService,
    cache_ttl_ms: u64,
    max_retries: u32,
    max_m3u_size_mb: usize,
}

impl M3UParser {
    /// Create a new M3U parser
    pub fn new(
        cache: CacheService,
        db_cache: DbCacheService,
        user_agent: &str,
        timeout_ms: u64,
        cache_ttl_ms: u64,
        max_retries: u32,
        max_m3u_size_mb: usize,
    ) -> Self {
        let client = Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_millis(timeout_ms))
            .gzip(true)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            cache,
            db_cache,
            cache_ttl_ms,
            max_retries,
            max_m3u_size_mb,
        }
    }

    async fn fetch_with_retry(&self, url: &str) -> Result<Response> {
        let mut last_err = None;

        for attempt in 0..=self.max_retries {
            match self.client.get(url).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Some(len) = resp.content_length() {
                            let max_bytes = (self.max_m3u_size_mb as u64) * 1024 * 1024;
                            if len > max_bytes {
                                bail!(
                                    "Playlist muito grande: {:.1}MB (limite {}MB)",
                                    len as f64 / 1024f64 / 1024f64,
                                    self.max_m3u_size_mb
                                );
                            }
                        }

                        return Ok(resp);
                    }

                    let status = resp.status();
                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < self.max_retries {
                        let backoff_ms = (1u64 << attempt).saturating_mul(500).min(10_000);
                        tracing::warn!("fetch_retry" = attempt + 1, "reason" = "429", "backoff_ms" = backoff_ms);
                        sleep(Duration::from_millis(backoff_ms)).await;
                        continue;
                    }

                    let friendly: String = match status {
                        reqwest::StatusCode::NOT_FOUND => "Playlist não encontrada (404). Verifique a URL.".to_string(),
                        reqwest::StatusCode::FORBIDDEN => "Acesso negado (403). A playlist pode exigir autenticação.".to_string(),
                        reqwest::StatusCode::TOO_MANY_REQUESTS => "Muitas requisições (429). O servidor do M3U está limitando acessos.".to_string(),
                        _ => {
                            let reason = status
                                .canonical_reason()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| "Erro".to_string());
                            format!("HTTP {}: {}", status.as_u16(), reason)
                        }
                    };

                    bail!("{}", friendly);
                }
                Err(err) => {
                    last_err = Some(err);
                    if attempt < self.max_retries {
                        let backoff_ms = (1u64 << attempt).saturating_mul(500).min(10_000);
                        tracing::warn!("fetch_retry" = attempt + 1, "reason" = "network", "backoff_ms" = backoff_ms);
                        sleep(Duration::from_millis(backoff_ms)).await;
                        continue;
                    } else {
                        return Err(last_err.unwrap().into());
                    }
                }
            }
        }

        match last_err {
            Some(e) => Err(e.into()),
            None => Err(anyhow!("Unknown fetch error")),
        }
    }

    /// Parse a playlist URL and save to cache
    /// Returns cache metadata with stats
    ///
    /// Features:
    /// - Streaming writes to PostgreSQL (prevents OOM on large playlists)
    /// - URL deduplication (skips duplicate URLs)
    /// - Title/group normalization (collapses multiple spaces)
    pub async fn parse_and_cache(&self, url: &str) -> Result<CacheMetadata> {
        let hash = hash_url(url);

        // Check if we already have valid cache in PostgreSQL
        if let Ok(Some(meta)) = self.db_cache.get_metadata(&hash).await {
            tracing::info!("PostgreSQL cache hit for {}", hash);
            return Ok(meta);
        }

        tracing::info!("Parsing playlist: {}", url);

        // Fetch and parse (with retry, limits, friendly errors)
        let response = self
            .fetch_with_retry(url)
            .await
            .context("Failed to fetch playlist")?;

        // Get content length for progress tracking
        let content_length = response.content_length();
        if let Some(len) = content_length {
            tracing::info!("Playlist size: {:.2} MB", len as f64 / 1024.0 / 1024.0);
        }

        // Create playlist record in PostgreSQL to get playlist_id
        let playlist_id = self.db_cache
            .save_playlist(&hash, url, &PlaylistStats::default(), None)
            .await
            .context("Failed to create playlist record")?;

        tracing::info!("Created playlist record: {}", playlist_id);

        // Stream the response body
        let bytes_stream = response.bytes_stream();

        // Convert to async reader for line-by-line parsing
        let stream_reader = StreamReader::new(
            bytes_stream.map(|result| result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
        );

        let mut reader = BufReader::new(stream_reader);
        let mut line = String::new();
        let mut current_extinf: Option<ExtinfData> = None;
        let mut item_index = 0usize;
        let mut found_header = false;

        // Stats tracking
        let mut stats = PlaylistStats::default();
        let mut groups: HashMap<String, (MediaKind, usize, Option<String>)> = HashMap::new();

        // Series accumulator for RLE grouping
        let mut series_accum: HashMap<String, SeriesAccumulator> = HashMap::new();

        // Current series run for RLE optimization
        let mut current_run: Option<SeriesRun> = None;

        // ✅ DEDUPLICATION: HashSet to track seen URLs
        let mut seen_urls: HashSet<u64> = HashSet::new();
        let mut duplicates_skipped = 0usize;

        // ✅ STREAMING WRITES: Create PostgreSQL streaming writer (prevents OOM)
        let mut writer = self.db_cache
            .create_streaming_writer(playlist_id)
            .await
            .context("Failed to create streaming writer")?;

        // Track if we had a parse error for cleanup
        let mut parse_error: Option<anyhow::Error> = None;

        // Main parsing loop
        loop {
            line.clear();

            let read_result = tokio::time::timeout(READ_LINE_TIMEOUT, reader.read_line(&mut line)).await;

            let bytes_read = match read_result {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => {
                    parse_error = Some(e.into());
                    break;
                }
                Err(_) => {
                    parse_error = Some(anyhow!("Timed out while reading playlist line"));
                    break;
                }
            };

            if bytes_read == 0 {
                break;
            }

            if line.len() > MAX_LINE_BYTES {
                parse_error = Some(anyhow!("Playlist line exceeds max length of {} bytes", MAX_LINE_BYTES));
                break;
            }

            let trimmed = line.trim();

            if trimmed.is_empty() {
                continue;
            }

            // Check M3U header
            if trimmed == "#EXTM3U" {
                found_header = true;
                continue;
            }

            // Skip non-EXTINF comments
            if trimmed.starts_with('#') && !trimmed.starts_with("#EXTINF:") {
                continue;
            }

            // Parse EXTINF
            if trimmed.starts_with("#EXTINF:") {
                current_extinf = parse_extinf(trimmed);
                continue;
            }

            // Stream URL line
            if let Some(extinf) = current_extinf.take() {
                if trimmed.starts_with("http") {
                    let stream_url = trimmed.to_string();

                    // ✅ DEDUPLICATION: Skip duplicate URLs
                    let url_hash = url_dedup_hash(&stream_url);
                    if !seen_urls.insert(url_hash) {
                        duplicates_skipped += 1;
                        continue;
                    }

                    // ✅ NORMALIZATION: Normalize title and group
                    let name = normalize_text(&extinf.title);
                    let group_title = normalize_text(
                        extinf.attributes.get("group-title")
                            .map(|s| s.as_str())
                            .unwrap_or("Sem Grupo")
                    );

                    // Extract metadata from attributes
                    let tvg_id = extinf.attributes.get("tvg-id").cloned();
                    let tvg_logo = extinf.attributes.get("tvg-logo").cloned();

                    // Classify content
                    let media_kind = ContentClassifier::classify(&name, &group_title);
                    let parsed_title = ContentClassifier::parse_title(&name);

                    // Extract series info for series items
                    let series_info = if media_kind == MediaKind::Series {
                        ContentClassifier::extract_series_info(&name)
                    } else {
                        None
                    };

                    // Generate series ID and track episodes
                    let (series_id, season_number, episode_number) = if let Some(ref info) = series_info {
                        let series_key = format!("{}_{}", group_title, info.series_name);
                        let series_db_id = format!("series_{}", hash_url(&series_key));
                        let item_id = generate_item_id(&stream_url, item_index);

                        // RLE: Check if this episode belongs to current run
                        let is_same_run = current_run
                            .as_ref()
                            .map(|run| run.series_key == series_key)
                            .unwrap_or(false);

                        if !is_same_run {
                            // Flush current run to accumulator
                            if let Some(run) = current_run.take() {
                                flush_run_to_accumulator(&mut series_accum, run);
                            }

                            // Start new run
                            current_run = Some(SeriesRun {
                                series_key: series_key.clone(),
                                series_name: info.series_name.clone(),
                                group: group_title.clone(),
                                logo: tvg_logo.clone(),
                                year: parsed_title.year,
                                quality: parsed_title.quality.clone(),
                                episodes: Vec::new(),
                            });
                        }

                        // Add episode to current run
                        if let Some(ref mut run) = current_run {
                            run.episodes.push(SeriesRunEpisode {
                                item_id: item_id.clone(),
                                name: name.clone(),
                                season: info.season,
                                episode: info.episode,
                                url: stream_url.clone(),
                            });
                        }

                        (Some(series_db_id), Some(info.season), Some(info.episode))
                    } else {
                        // Not a series - flush current run if any
                        if let Some(run) = current_run.take() {
                            flush_run_to_accumulator(&mut series_accum, run);
                        }
                        (None, None, None)
                    };

                    // Update stats
                    stats.total_items += 1;
                    match media_kind {
                        MediaKind::Live => stats.live_count += 1,
                        MediaKind::Movie => stats.movie_count += 1,
                        MediaKind::Series => stats.series_count += 1,
                        MediaKind::Unknown => stats.unknown_count += 1,
                    }

                    // Update groups
                    let group_entry = groups
                        .entry(group_title.clone())
                        .or_insert((media_kind, 0, tvg_logo.clone()));
                    group_entry.1 += 1;

                    // Create item with season/episode numbers
                    let item = PlaylistItem {
                        id: generate_item_id(&stream_url, item_index),
                        name,
                        url: stream_url,
                        logo: tvg_logo,
                        group: group_title,
                        media_kind,
                        parsed_title: Some(parsed_title),
                        epg_id: tvg_id,
                        series_id,
                        season_number,
                        episode_number,
                    };

                    // ✅ STREAMING WRITE: Write item directly to PostgreSQL
                    if let Err(e) = writer.write_item(&item).await {
                        parse_error = Some(e.into());
                        break;
                    }
                    item_index += 1;

                    // Log progress every 10k items
                    if item_index % 10000 == 0 {
                        tracing::info!("Parsed {} items (skipped {} duplicates)...", item_index, duplicates_skipped);
                    }
                }
            }
        }

        // Handle parse errors - transaction auto-rollbacks on drop
        if let Some(e) = parse_error {
            // Delete the partially created playlist
            let _ = self.db_cache.delete_playlist(&hash).await;
            return Err(e);
        }

        // Flush final run if any
        if let Some(run) = current_run.take() {
            flush_run_to_accumulator(&mut series_accum, run);
        }

        if !found_header {
            // Delete the partially created playlist
            let _ = self.db_cache.delete_playlist(&hash).await;
            anyhow::bail!("Invalid playlist format (missing #EXTM3U header)");
        }

        // ✅ FINALIZE: Flush remaining items and commit transaction
        let items_written = writer.finish().await
            .context("Failed to finish writing items")?;

        tracing::info!(
            "Parsing complete: {} items written ({} duplicates skipped)",
            items_written,
            duplicates_skipped
        );

        // Convert groups to vec
        let groups_vec: Vec<PlaylistGroup> = groups
            .into_iter()
            .map(|(name, (media_kind, count, logo))| PlaylistGroup {
                id: format!("group_{}", hash_url(&name)),
                name,
                media_kind,
                item_count: count,
                logo,
            })
            .collect();

        stats.group_count = groups_vec.len();

        // Convert series accumulator to SeriesInfo with sorted episodes
        let series_vec: Vec<SeriesInfo> = series_accum
            .into_values()
            .map(|accum| build_series_info(accum))
            .collect();

        tracing::info!(
            "Series grouped: {} series with {} total episodes",
            series_vec.len(),
            series_vec.iter().map(|s| s.total_episodes).sum::<usize>()
        );

        // Save groups to PostgreSQL
        self.db_cache.save_groups(playlist_id, &groups_vec).await
            .context("Failed to save groups")?;

        // Save series to PostgreSQL
        self.db_cache.save_series(playlist_id, &series_vec).await
            .context("Failed to save series")?;

        // Update playlist stats
        self.db_cache.update_stats(&hash, &stats).await
            .context("Failed to update stats")?;

        tracing::info!("PostgreSQL cache saved for {} ({} items)", hash, stats.total_items);

        // Return metadata from PostgreSQL
        self.db_cache.get_metadata(&hash).await?
            .ok_or_else(|| anyhow!("Failed to retrieve saved metadata"))
    }

    /// Parse a playlist URL with progress reporting to Redis
    /// This is the background processing version that updates progress in real-time
    pub async fn parse_and_cache_with_progress(
        &self,
        url: &str,
        redis: &crate::services::redis::RedisService,
    ) -> Result<CacheMetadata> {
        use crate::services::redis::ParseProgress;

        let hash = hash_url(url);

        // Check if we already have valid cache in PostgreSQL
        if let Ok(Some(meta)) = self.db_cache.get_metadata(&hash).await {
            tracing::info!("PostgreSQL cache hit for {}", hash);
            return Ok(meta);
        }

        // Update progress to downloading
        let mut progress = ParseProgress::new_parsing();
        progress.current_phase = "downloading".to_string();
        let _ = redis.set_parse_progress(&hash, &progress).await;

        tracing::info!("Parsing playlist with progress: {}", url);

        // Fetch and parse (with retry, limits, friendly errors)
        let response = self
            .fetch_with_retry(url)
            .await
            .context("Failed to fetch playlist")?;

        // Get content length for progress estimation
        let content_length = response.content_length();
        if let Some(len) = content_length {
            tracing::info!("Playlist size: {:.2} MB", len as f64 / 1024.0 / 1024.0);
            // Estimate ~200 bytes per item average for IPTV playlists
            progress.items_total = Some(len / 200);
        }

        // Update progress to parsing
        progress.current_phase = "parsing".to_string();
        let _ = redis.set_parse_progress(&hash, &progress).await;

        // Create playlist record in PostgreSQL to get playlist_id
        let playlist_id = self.db_cache
            .save_playlist(&hash, url, &PlaylistStats::default(), None)
            .await
            .context("Failed to create playlist record")?;

        tracing::info!("Created playlist record: {}", playlist_id);

        // Stream the response body
        let bytes_stream = response.bytes_stream();
        let stream_reader = StreamReader::new(
            bytes_stream.map(|result| result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
        );

        let mut reader = BufReader::new(stream_reader);
        let mut line = String::new();
        let mut current_extinf: Option<ExtinfData> = None;
        let mut item_index = 0usize;
        let mut found_header = false;

        // Stats tracking
        let mut stats = PlaylistStats::default();
        let mut groups: HashMap<String, (MediaKind, usize, Option<String>)> = HashMap::new();

        // Series accumulator for RLE grouping
        let mut series_accum: HashMap<String, SeriesAccumulator> = HashMap::new();
        let mut current_run: Option<SeriesRun> = None;

        // Deduplication
        let mut seen_urls: HashSet<u64> = HashSet::new();
        let mut duplicates_skipped = 0usize;

        // Streaming writes
        let mut writer = self.db_cache
            .create_streaming_writer(playlist_id)
            .await
            .context("Failed to create streaming writer")?;

        let mut parse_error: Option<anyhow::Error> = None;

        // Main parsing loop
        loop {
            line.clear();

            let read_result = tokio::time::timeout(READ_LINE_TIMEOUT, reader.read_line(&mut line)).await;

            let bytes_read = match read_result {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => {
                    parse_error = Some(e.into());
                    break;
                }
                Err(_) => {
                    parse_error = Some(anyhow!("Timed out while reading playlist line"));
                    break;
                }
            };

            if bytes_read == 0 {
                break;
            }

            if line.len() > MAX_LINE_BYTES {
                parse_error = Some(anyhow!("Playlist line exceeds max length of {} bytes", MAX_LINE_BYTES));
                break;
            }

            let trimmed = line.trim();

            if trimmed.is_empty() {
                continue;
            }

            // Check M3U header
            if trimmed == "#EXTM3U" {
                found_header = true;
                continue;
            }

            // Skip non-EXTINF comments
            if trimmed.starts_with('#') && !trimmed.starts_with("#EXTINF:") {
                continue;
            }

            // Parse EXTINF
            if trimmed.starts_with("#EXTINF:") {
                current_extinf = parse_extinf(trimmed);
                continue;
            }

            // Stream URL line
            if let Some(extinf) = current_extinf.take() {
                if trimmed.starts_with("http") {
                    let stream_url = trimmed.to_string();

                    // Deduplication
                    let url_hash = url_dedup_hash(&stream_url);
                    if !seen_urls.insert(url_hash) {
                        duplicates_skipped += 1;
                        continue;
                    }

                    // Normalization
                    let name = normalize_text(&extinf.title);
                    let group_title = normalize_text(
                        extinf.attributes.get("group-title")
                            .map(|s| s.as_str())
                            .unwrap_or("Sem Grupo")
                    );

                    let tvg_id = extinf.attributes.get("tvg-id").cloned();
                    let tvg_logo = extinf.attributes.get("tvg-logo").cloned();

                    // Classify content
                    let media_kind = ContentClassifier::classify(&name, &group_title);
                    let parsed_title = ContentClassifier::parse_title(&name);

                    // Extract series info
                    let series_info = if media_kind == MediaKind::Series {
                        ContentClassifier::extract_series_info(&name)
                    } else {
                        None
                    };

                    // Generate series ID and track episodes
                    let (series_id, season_number, episode_number) = if let Some(ref info) = series_info {
                        let series_key = format!("{}_{}", group_title, info.series_name);
                        let series_db_id = format!("series_{}", hash_url(&series_key));
                        let item_id = generate_item_id(&stream_url, item_index);

                        let is_same_run = current_run
                            .as_ref()
                            .map(|run| run.series_key == series_key)
                            .unwrap_or(false);

                        if !is_same_run {
                            if let Some(run) = current_run.take() {
                                flush_run_to_accumulator(&mut series_accum, run);
                            }

                            current_run = Some(SeriesRun {
                                series_key: series_key.clone(),
                                series_name: info.series_name.clone(),
                                group: group_title.clone(),
                                logo: tvg_logo.clone(),
                                year: parsed_title.year,
                                quality: parsed_title.quality.clone(),
                                episodes: Vec::new(),
                            });
                        }

                        if let Some(ref mut run) = current_run {
                            run.episodes.push(SeriesRunEpisode {
                                item_id: item_id.clone(),
                                name: name.clone(),
                                season: info.season,
                                episode: info.episode,
                                url: stream_url.clone(),
                            });
                        }

                        (Some(series_db_id), Some(info.season), Some(info.episode))
                    } else {
                        if let Some(run) = current_run.take() {
                            flush_run_to_accumulator(&mut series_accum, run);
                        }
                        (None, None, None)
                    };

                    // Update stats
                    stats.total_items += 1;
                    match media_kind {
                        MediaKind::Live => stats.live_count += 1,
                        MediaKind::Movie => stats.movie_count += 1,
                        MediaKind::Series => stats.series_count += 1,
                        MediaKind::Unknown => stats.unknown_count += 1,
                    }

                    // Update groups
                    let group_entry = groups
                        .entry(group_title.clone())
                        .or_insert((media_kind, 0, tvg_logo.clone()));
                    group_entry.1 += 1;

                    // Create item
                    let item = PlaylistItem {
                        id: generate_item_id(&stream_url, item_index),
                        name,
                        url: stream_url,
                        logo: tvg_logo,
                        group: group_title,
                        media_kind,
                        parsed_title: Some(parsed_title),
                        epg_id: tvg_id,
                        series_id,
                        season_number,
                        episode_number,
                    };

                    // Write item
                    if let Err(e) = writer.write_item(&item).await {
                        parse_error = Some(e.into());
                        break;
                    }
                    item_index += 1;

                    // ✅ UPDATE PROGRESS every 500 items (batch size)
                    if item_index % 500 == 0 {
                        progress.items_parsed = item_index as u64;
                        progress.groups_count = groups.len() as u64;
                        progress.updated_at = chrono::Utc::now().timestamp_millis();
                        let _ = redis.set_parse_progress(&hash, &progress).await;

                        // Log progress every 10k items
                        if item_index % 10000 == 0 {
                            tracing::info!("Parsed {} items (skipped {} duplicates)...", item_index, duplicates_skipped);
                        }
                    }
                }
            }
        }

        // Handle parse errors
        if let Some(e) = parse_error {
            let _ = self.db_cache.delete_playlist(&hash).await;
            return Err(e);
        }

        // Flush final run
        if let Some(run) = current_run.take() {
            flush_run_to_accumulator(&mut series_accum, run);
        }

        if !found_header {
            let _ = self.db_cache.delete_playlist(&hash).await;
            anyhow::bail!("Invalid playlist format (missing #EXTM3U header)");
        }

        // Update progress to building_groups
        progress.items_parsed = item_index as u64;
        progress.current_phase = "building_groups".to_string();
        progress.status = "building_groups".to_string();
        let _ = redis.set_parse_progress(&hash, &progress).await;

        // Finalize items
        let items_written = writer.finish().await
            .context("Failed to finish writing items")?;

        tracing::info!(
            "Parsing complete: {} items written ({} duplicates skipped)",
            items_written,
            duplicates_skipped
        );

        // Convert groups
        let groups_vec: Vec<PlaylistGroup> = groups
            .into_iter()
            .map(|(name, (media_kind, count, logo))| PlaylistGroup {
                id: format!("group_{}", hash_url(&name)),
                name,
                media_kind,
                item_count: count,
                logo,
            })
            .collect();

        stats.group_count = groups_vec.len();

        // Update progress for series phase
        progress.current_phase = "building_series".to_string();
        progress.groups_count = stats.group_count as u64;
        let _ = redis.set_parse_progress(&hash, &progress).await;

        // Convert series accumulator
        let series_vec: Vec<SeriesInfo> = series_accum
            .into_values()
            .map(|accum| build_series_info(accum))
            .collect();

        tracing::info!(
            "Series grouped: {} series with {} total episodes",
            series_vec.len(),
            series_vec.iter().map(|s| s.total_episodes).sum::<usize>()
        );

        // Save to PostgreSQL
        self.db_cache.save_groups(playlist_id, &groups_vec).await
            .context("Failed to save groups")?;

        self.db_cache.save_series(playlist_id, &series_vec).await
            .context("Failed to save series")?;

        self.db_cache.update_stats(&hash, &stats).await
            .context("Failed to update stats")?;

        // Update progress to complete
        progress.series_count = series_vec.len() as u64;
        progress.current_phase = "done".to_string();
        progress.status = "complete".to_string();
        progress.items_total = Some(stats.total_items as u64);
        let _ = redis.set_parse_progress(&hash, &progress).await;

        tracing::info!("PostgreSQL cache saved for {} ({} items)", hash, stats.total_items);

        // Return metadata
        self.db_cache.get_metadata(&hash).await?
            .ok_or_else(|| anyhow!("Failed to retrieve saved metadata"))
    }

    // NOTE: get_items, get_metadata, and stream_items were removed.
    // All data access should go through db_cache (PostgreSQL) directly.
    // Routes use state.db_cache for reading data.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_url() {
        let hash = hash_url("http://example.com/playlist.m3u");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 40); // SHA1 produces 40 hex chars
    }

    #[test]
    fn test_generate_item_id() {
        let id1 = generate_item_id("http://stream1.com", 0);
        let id2 = generate_item_id("http://stream2.com", 0);
        assert_ne!(id1, id2);
        assert!(id1.starts_with("item_"));
    }

    #[test]
    fn test_parse_extinf() {
        let line = r#"#EXTINF:-1 tvg-id="globo" tvg-name="Globo HD" tvg-logo="http://logo.com/globo.png" group-title="TV",Globo HD"#;
        let extinf = parse_extinf(line).unwrap();

        assert_eq!(extinf.title, "Globo HD");
        assert_eq!(extinf._duration, -1);
        assert_eq!(extinf.attributes.get("tvg-id"), Some(&"globo".to_string()));
        assert_eq!(extinf.attributes.get("group-title"), Some(&"TV".to_string()));
    }

    #[test]
    fn test_parse_extinf_minimal() {
        let line = "#EXTINF:-1,Canal Teste";
        let extinf = parse_extinf(line).unwrap();

        assert_eq!(extinf.title, "Canal Teste");
        assert_eq!(extinf._duration, -1);
        assert!(extinf.attributes.is_empty());
    }
}
