//! Xtream Codes API Types
//!
//! Type definitions for Xtream Codes Player API v2 responses.
//! Includes normalization helpers inspired by @iptv/xtream-api

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

// ============================================================================
// Flexible Deserialization Helpers (handle Xtream API inconsistencies)
// ============================================================================

/// Deserialize a value that could be either a string or an integer into Option<String>
/// Xtream APIs are inconsistent - sometimes return "1" sometimes return 1
fn deserialize_string_or_int<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct StringOrIntVisitor;

    impl<'de> Visitor<'de> for StringOrIntVisitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string, an integer, or null")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
        where
            D: Deserializer<'de>,
        {
            deserializer.deserialize_any(StringOrIntInnerVisitor)
        }
    }

    struct StringOrIntInnerVisitor;

    impl<'de> Visitor<'de> for StringOrIntInnerVisitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or an integer")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value.to_string()))
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value))
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value.to_string()))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value.to_string()))
        }

        fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value.to_string()))
        }

        fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(if value { "1".to_string() } else { "0".to_string() }))
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }
    }

    deserializer.deserialize_option(StringOrIntVisitor)
}

/// Deserialize a required string that could be either string, integer, or null (null becomes empty string)
fn deserialize_string_or_int_required<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct StringOrIntRequiredVisitor;

    impl<'de> Visitor<'de> for StringOrIntRequiredVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string, an integer, or null")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value)
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(if value { "1".to_string() } else { "0".to_string() })
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(String::new())
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(String::new())
        }
    }

    deserializer.deserialize_any(StringOrIntRequiredVisitor)
}

/// Deserialize a required i64 that can come as string/int/bool/null
fn deserialize_i64_required<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct I64Visitor;

    impl<'de> Visitor<'de> for I64Visitor {
        type Value = i64;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an integer, a stringified integer, or null")
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value as i64)
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value
                .parse::<i64>()
                .map_err(|_| E::custom(format!("invalid integer string: {}", value)))
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            self.visit_str(&value)
        }

        fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(if value { 1 } else { 0 })
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(0)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(0)
        }
    }

    deserializer.deserialize_any(I64Visitor)
}

// ============================================================================
// Normalization Helpers (inspired by @iptv/xtream-api)
// ============================================================================

/// Decode base64 string if it's valid base64, otherwise return original
/// Used for EPG titles/descriptions that some servers encode
pub fn decode_base64_if_needed(s: &str) -> String {
    // Skip if empty or looks like normal text (has spaces, common chars)
    if s.is_empty() || s.contains(' ') || s.len() < 4 {
        return s.to_string();
    }

    // Try to decode - only if it looks like base64 (alphanumeric + /+=)
    if s.chars().all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '=') {
        if let Ok(bytes) = STANDARD.decode(s) {
            if let Ok(decoded) = String::from_utf8(bytes) {
                // Only use decoded if it's printable text
                if decoded.chars().all(|c| !c.is_control() || c == '\n' || c == '\r') {
                    return decoded;
                }
            }
        }
    }

    s.to_string()
}

/// Split comma-separated string into trimmed array
/// Used for cast, genre, director fields
pub fn split_csv(s: &Option<String>) -> Vec<String> {
    s.as_ref()
        .map(|v| {
            v.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Convert Unix timestamp string to ISO8601 date string
/// Returns None if invalid
pub fn timestamp_to_iso(ts: &Option<String>) -> Option<String> {
    ts.as_ref()
        .and_then(|s| s.parse::<i64>().ok())
        .and_then(|ts| Utc.timestamp_opt(ts, 0).single())
        .map(|dt| dt.to_rfc3339())
}

/// Convert Unix timestamp to DateTime<Utc>
pub fn timestamp_to_datetime(ts: &Option<String>) -> Option<DateTime<Utc>> {
    ts.as_ref()
        .and_then(|s| s.parse::<i64>().ok())
        .and_then(|ts| Utc.timestamp_opt(ts, 0).single())
}

/// Parse rating string to f32
/// Handles both "8.5" and "85" (divided by 10) formats
pub fn parse_rating(s: &Option<String>) -> Option<f32> {
    s.as_ref().and_then(|r| {
        let trimmed = r.trim();
        if trimmed.is_empty() {
            return None;
        }
        trimmed.parse::<f32>().ok().map(|v| {
            // If rating is > 10, assume it's out of 100 and normalize
            if v > 10.0 {
                v / 10.0
            } else {
                v
            }
        })
    })
}

/// Parse duration string to seconds
/// Handles formats like "01:30:00", "90 min", "5400"
pub fn parse_duration_to_secs(s: &Option<String>) -> Option<i64> {
    let s = s.as_ref()?;
    let trimmed = s.trim();

    // Already in seconds
    if let Ok(secs) = trimmed.parse::<i64>() {
        return Some(secs);
    }

    // Format: "HH:MM:SS"
    if trimmed.contains(':') {
        let parts: Vec<&str> = trimmed.split(':').collect();
        if parts.len() == 3 {
            if let (Ok(h), Ok(m), Ok(s)) = (
                parts[0].parse::<i64>(),
                parts[1].parse::<i64>(),
                parts[2].parse::<i64>(),
            ) {
                return Some(h * 3600 + m * 60 + s);
            }
        } else if parts.len() == 2 {
            if let (Ok(m), Ok(s)) = (parts[0].parse::<i64>(), parts[1].parse::<i64>()) {
                return Some(m * 60 + s);
            }
        }
    }

    // Format: "90 min" or "90min"
    let lower = trimmed.to_lowercase();
    if lower.contains("min") {
        let num_str: String = lower.chars().filter(|c| c.is_ascii_digit()).collect();
        if let Ok(mins) = num_str.parse::<i64>() {
            return Some(mins * 60);
        }
    }

    None
}

/// Generate seasons from episodes map when seasons array is empty
/// Extracts season numbers from episode keys and creates Season entries
pub fn generate_seasons_from_episodes(episodes: &HashMap<String, Vec<XtreamEpisode>>) -> Vec<XtreamSeason> {
    let mut seasons: Vec<XtreamSeason> = episodes
        .keys()
        .filter_map(|k| k.parse::<i32>().ok())
        .map(|num| {
            // Try to get cover from first episode of this season
            let cover = episodes
                .get(&num.to_string())
                .and_then(|eps| eps.first())
                .and_then(|ep| ep.info.as_ref())
                .and_then(|info| info.movie_image.clone());

            XtreamSeason {
                air_date: None,
                episode_count: episodes.get(&num.to_string()).map(|eps| eps.len() as i32),
                id: None,
                name: Some(format!("Temporada {}", num)),
                overview: None,
                season_number: Some(num),
                cover: cover.clone(),
                cover_big: cover,
            }
        })
        .collect();

    // Sort by season number
    seasons.sort_by_key(|s| s.season_number.unwrap_or(0));
    seasons
}

/// Extracted credentials from M3U URL
#[derive(Debug, Clone)]
pub struct XtreamCredentials {
    /// Server base URL (e.g., "http://example.com:8080")
    pub server: String,
    /// Username for authentication
    pub username: String,
    /// Password for authentication
    pub password: String,
    /// Preferred live format (ts/m3u8/rtmp)
    pub preferred_live_format: String,
}

impl XtreamCredentials {
    /// Build the player_api.php base URL
    pub fn api_url(&self) -> String {
        format!(
            "{}/player_api.php?username={}&password={}",
            self.server, self.username, self.password
        )
    }

    /// Build playback URL for live streams (respects preferred_live_format)
    pub fn live_url(&self, stream_id: i64) -> String {
        self.live_url_with_format(stream_id, None)
    }

    /// Build playback URL for live streams with optional override format
    pub fn live_url_with_format(&self, stream_id: i64, fmt: Option<&str>) -> String {
        let ext = fmt.unwrap_or(&self.preferred_live_format);
        format!(
            "{}/live/{}/{}/{}.{}",
            self.server, self.username, self.password, stream_id, ext
        )
    }

    /// Build playback URL for VOD
    pub fn vod_url(&self, stream_id: i64, extension: &str) -> String {
        format!(
            "{}/movie/{}/{}/{}.{}",
            self.server, self.username, self.password, stream_id, extension
        )
    }

    /// Build playback URL for series episodes
    pub fn series_url(&self, episode_id: i64, extension: &str) -> String {
        format!(
            "{}/series/{}/{}/{}.{}",
            self.server, self.username, self.password, episode_id, extension
        )
    }

    /// Build EPG XML URL
    pub fn epg_url(&self) -> String {
        format!(
            "{}/xmltv.php?username={}&password={}",
            self.server, self.username, self.password
        )
    }
}

// ============================================================================
// Authentication Response Types
// ============================================================================

/// Main authentication response from player_api.php (no action)
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamAuthResponse {
    pub user_info: XtreamUserInfo,
    pub server_info: XtreamServerInfo,
}

/// User account information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamUserInfo {
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub username: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub password: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub status: String,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub exp_date: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub is_trial: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub active_cons: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub created_at: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub max_connections: Option<String>,
    #[serde(default)]
    pub allowed_output_formats: Option<Vec<String>>,
}

impl XtreamUserInfo {
    /// Check if account is active
    pub fn is_active(&self) -> bool {
        self.status.eq_ignore_ascii_case("active")
    }

    /// Parse expiration timestamp to Unix timestamp
    pub fn exp_timestamp(&self) -> Option<i64> {
        self.exp_date.as_ref()?.parse().ok()
    }

    /// Parse max_connections to i16
    pub fn max_connections_i16(&self) -> Option<i16> {
        self.max_connections.as_ref()?.parse().ok()
    }

    /// Check if trial account
    pub fn is_trial_account(&self) -> bool {
        self.is_trial.as_ref().map(|s| s == "1").unwrap_or(false)
    }
}

/// Server information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamServerInfo {
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub url: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub port: String,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub https_port: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub server_protocol: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub rtmp_port: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub timezone: Option<String>,
    #[serde(default)]
    pub timestamp_now: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub time_now: Option<String>,
}

// ============================================================================
// Category Types
// ============================================================================

/// Category for live, VOD, or series
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamCategory {
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub category_id: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub category_name: String,
    #[serde(default)]
    pub parent_id: Option<i32>,
}

// ============================================================================
// Live Stream Types
// ============================================================================

/// Live stream (channel) information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamLiveStream {
    #[serde(default)]
    pub num: Option<i32>,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub name: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub stream_type: String,
    pub stream_id: i64,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub stream_icon: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub epg_channel_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub added: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub category_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub custom_sid: Option<String>,
    #[serde(default)]
    pub tv_archive: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub direct_source: Option<String>,
    #[serde(default)]
    pub tv_archive_duration: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub is_adult: Option<String>,
}

// ============================================================================
// VOD Types
// ============================================================================

/// VOD (movie) stream information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamVodStream {
    #[serde(default)]
    pub num: Option<i32>,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub name: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub stream_type: String,
    pub stream_id: i64,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub stream_icon: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub rating: Option<String>,
    #[serde(default, rename = "rating_5based")]
    pub rating_5based: Option<f32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub added: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub category_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub container_extension: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub custom_sid: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub direct_source: Option<String>,
}

/// Detailed VOD information (from get_vod_info)
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamVodInfo {
    pub info: XtreamVodDetails,
    pub movie_data: XtreamVodStream,
}

/// VOD metadata details
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamVodDetails {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub tmdb_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub title: Option<String>,
    #[serde(default, rename = "o_name", deserialize_with = "deserialize_string_or_int")]
    pub original_name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cover_big: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub movie_image: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub releasedate: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub episode_run_time: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub youtube_trailer: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub director: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub actors: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cast: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub plot: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub age: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub mpaa_rating: Option<String>,
    #[serde(default)]
    pub rating_count_kinopoisk: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub country: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub genre: Option<String>,
    #[serde(default)]
    pub backdrop_path: Option<Vec<String>>,
    #[serde(default)]
    pub duration_secs: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub duration: Option<String>,
    #[serde(default)]
    pub bitrate: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub rating: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub year: Option<String>,
}

// ============================================================================
// Series Types
// ============================================================================

/// Series information from get_series
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeries {
    #[serde(default, deserialize_with = "deserialize_i64_required")]
    pub series_id: i64,
    #[serde(default, deserialize_with = "deserialize_string_or_int_required")]
    pub name: String,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cover: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub plot: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cast: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub director: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub genre: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub releaseDate: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub last_modified: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub rating: Option<String>,
    #[serde(default, rename = "rating_5based")]
    pub rating_5based: Option<f32>,
    #[serde(default)]
    pub backdrop_path: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub youtube_trailer: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub episode_run_time: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub category_id: Option<String>,
}

/// Detailed series information (from get_series_info)
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeriesInfo {
    #[serde(default)]
    pub seasons: Option<Vec<XtreamSeason>>,
    pub info: XtreamSeriesDetails,
    /// Episodes grouped by season number (key is season number as string)
    #[serde(default, deserialize_with = "deserialize_episodes_map_or_null")]
    pub episodes: HashMap<String, Vec<XtreamEpisode>>,
}

/// Deserialize episodes map, treating null as empty map
fn deserialize_episodes_map_or_null<'de, D>(
    deserializer: D,
) -> Result<HashMap<String, Vec<XtreamEpisode>>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<HashMap<String, Vec<XtreamEpisode>>>::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

/// Season information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeason {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub air_date: Option<String>,
    #[serde(default)]
    pub episode_count: Option<i32>,
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub overview: Option<String>,
    #[serde(default)]
    pub season_number: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cover: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cover_big: Option<String>,
}

/// Series metadata details
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeriesDetails {
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cover: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub plot: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub cast: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub director: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub genre: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub releaseDate: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub last_modified: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub rating: Option<String>,
    #[serde(default, rename = "rating_5based")]
    pub rating_5based: Option<f32>,
    #[serde(default)]
    pub backdrop_path: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub youtube_trailer: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub episode_run_time: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub category_id: Option<String>,
}

/// Episode information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpisode {
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub id: String,
    pub episode_num: i32,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub title: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub container_extension: String,
    #[serde(default)]
    pub info: Option<XtreamEpisodeInfo>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub custom_sid: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub added: Option<String>,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub direct_source: Option<String>,
}

/// Episode metadata
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpisodeInfo {
    #[serde(default)]
    pub tmdb_id: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub releasedate: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub plot: Option<String>,
    #[serde(default)]
    pub duration_secs: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub duration: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub movie_image: Option<String>,
    #[serde(default)]
    pub bitrate: Option<i32>,
    #[serde(default)]
    pub rating: Option<f32>,
    #[serde(default)]
    pub season: Option<i32>,
}

// ============================================================================
// EPG Types
// ============================================================================

/// Short EPG entry (from get_short_epg)
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpgEntry {
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub id: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub epg_id: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub title: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub lang: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub start: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub end: String,
    #[serde(default, deserialize_with = "deserialize_string_or_int")]
    pub description: Option<String>,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub channel_id: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub start_timestamp: String,
    #[serde(deserialize_with = "deserialize_string_or_int_required")]
    pub stop_timestamp: String,
    /// Whether this program has archive available (1 = yes, 0 = no)
    #[serde(default)]
    pub has_archive: Option<i32>,
    /// Now playing flag
    #[serde(default)]
    pub now_playing: Option<i32>,
}

/// EPG listings container
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpgListings {
    pub epg_listings: Vec<XtreamEpgEntry>,
}
