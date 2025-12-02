//! Xtream Codes API Types
//!
//! Type definitions for Xtream Codes Player API v2 responses.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Extracted credentials from M3U URL
#[derive(Debug, Clone)]
pub struct XtreamCredentials {
    /// Server base URL (e.g., "http://example.com:8080")
    pub server: String,
    /// Username for authentication
    pub username: String,
    /// Password for authentication
    pub password: String,
}

impl XtreamCredentials {
    /// Build the player_api.php base URL
    pub fn api_url(&self) -> String {
        format!(
            "{}/player_api.php?username={}&password={}",
            self.server, self.username, self.password
        )
    }

    /// Build playback URL for live streams
    pub fn live_url(&self, stream_id: i64) -> String {
        format!(
            "{}/live/{}/{}/{}.ts",
            self.server, self.username, self.password, stream_id
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
    pub username: String,
    pub password: String,
    pub status: String,
    #[serde(default)]
    pub exp_date: Option<String>,
    #[serde(default)]
    pub is_trial: Option<String>,
    #[serde(default)]
    pub active_cons: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
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
    pub url: String,
    pub port: String,
    #[serde(default)]
    pub https_port: Option<String>,
    #[serde(default)]
    pub server_protocol: Option<String>,
    #[serde(default)]
    pub rtmp_port: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub timestamp_now: Option<i64>,
    #[serde(default)]
    pub time_now: Option<String>,
}

// ============================================================================
// Category Types
// ============================================================================

/// Category for live, VOD, or series
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamCategory {
    pub category_id: String,
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
    pub name: String,
    pub stream_type: String,
    pub stream_id: i64,
    #[serde(default)]
    pub stream_icon: Option<String>,
    #[serde(default)]
    pub epg_channel_id: Option<String>,
    #[serde(default)]
    pub added: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub custom_sid: Option<String>,
    #[serde(default)]
    pub tv_archive: Option<i32>,
    #[serde(default)]
    pub direct_source: Option<String>,
    #[serde(default)]
    pub tv_archive_duration: Option<i32>,
    #[serde(default)]
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
    pub name: String,
    pub stream_type: String,
    pub stream_id: i64,
    #[serde(default)]
    pub stream_icon: Option<String>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default, rename = "rating_5based")]
    pub rating_5based: Option<f32>,
    #[serde(default)]
    pub added: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub container_extension: Option<String>,
    #[serde(default)]
    pub custom_sid: Option<String>,
    #[serde(default)]
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
    #[serde(default)]
    pub tmdb_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, rename = "o_name")]
    pub original_name: Option<String>,
    #[serde(default)]
    pub cover_big: Option<String>,
    #[serde(default)]
    pub movie_image: Option<String>,
    #[serde(default)]
    pub releasedate: Option<String>,
    #[serde(default)]
    pub episode_run_time: Option<String>,
    #[serde(default)]
    pub youtube_trailer: Option<String>,
    #[serde(default)]
    pub director: Option<String>,
    #[serde(default)]
    pub actors: Option<String>,
    #[serde(default)]
    pub cast: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub plot: Option<String>,
    #[serde(default)]
    pub age: Option<String>,
    #[serde(default)]
    pub mpaa_rating: Option<String>,
    #[serde(default)]
    pub rating_count_kinopoisk: Option<i32>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub backdrop_path: Option<Vec<String>>,
    #[serde(default)]
    pub duration_secs: Option<i64>,
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(default)]
    pub bitrate: Option<i32>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
}

// ============================================================================
// Series Types
// ============================================================================

/// Series information from get_series
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeries {
    pub series_id: i64,
    pub name: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub plot: Option<String>,
    #[serde(default)]
    pub cast: Option<String>,
    #[serde(default)]
    pub director: Option<String>,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub releaseDate: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default, rename = "rating_5based")]
    pub rating_5based: Option<f32>,
    #[serde(default)]
    pub backdrop_path: Option<Vec<String>>,
    #[serde(default)]
    pub youtube_trailer: Option<String>,
    #[serde(default)]
    pub episode_run_time: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
}

/// Detailed series information (from get_series_info)
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeriesInfo {
    #[serde(default)]
    pub seasons: Option<Vec<XtreamSeason>>,
    pub info: XtreamSeriesDetails,
    /// Episodes grouped by season number (key is season number as string)
    pub episodes: HashMap<String, Vec<XtreamEpisode>>,
}

/// Season information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeason {
    #[serde(default)]
    pub air_date: Option<String>,
    #[serde(default)]
    pub episode_count: Option<i32>,
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub season_number: Option<i32>,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub cover_big: Option<String>,
}

/// Series metadata details
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamSeriesDetails {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub plot: Option<String>,
    #[serde(default)]
    pub cast: Option<String>,
    #[serde(default)]
    pub director: Option<String>,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub releaseDate: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub rating: Option<String>,
    #[serde(default, rename = "rating_5based")]
    pub rating_5based: Option<f32>,
    #[serde(default)]
    pub backdrop_path: Option<Vec<String>>,
    #[serde(default)]
    pub youtube_trailer: Option<String>,
    #[serde(default)]
    pub episode_run_time: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
}

/// Episode information
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpisode {
    pub id: String,
    pub episode_num: i32,
    pub title: String,
    pub container_extension: String,
    #[serde(default)]
    pub info: Option<XtreamEpisodeInfo>,
    #[serde(default)]
    pub custom_sid: Option<String>,
    #[serde(default)]
    pub added: Option<String>,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub direct_source: Option<String>,
}

/// Episode metadata
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpisodeInfo {
    #[serde(default)]
    pub tmdb_id: Option<i64>,
    #[serde(default)]
    pub releasedate: Option<String>,
    #[serde(default)]
    pub plot: Option<String>,
    #[serde(default)]
    pub duration_secs: Option<i64>,
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(default)]
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
    pub id: String,
    pub epg_id: String,
    pub title: String,
    pub lang: String,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub description: Option<String>,
    pub channel_id: String,
    pub start_timestamp: String,
    pub stop_timestamp: String,
}

/// EPG listings container
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct XtreamEpgListings {
    pub epg_listings: Vec<XtreamEpgEntry>,
}
