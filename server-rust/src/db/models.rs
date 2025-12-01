//! Database row types for PostgreSQL
//!
//! These types map directly to database rows and can be converted
//! to the API response types in models/playlist.rs

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::models::playlist::{
    MediaKind, ParsedTitle, PlaylistGroup, PlaylistItem, PlaylistStats, SeriesEpisode, SeriesInfo,
};

// ============================================================================
// Database Row Types
// ============================================================================

/// Client row from database
#[derive(Debug, Clone, FromRow)]
pub struct ClientRow {
    pub id: Uuid,
    pub external_id: Option<String>,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Playlist row from database
#[derive(Debug, Clone, FromRow)]
pub struct PlaylistRow {
    pub id: Uuid,
    pub client_id: Option<Uuid>,
    pub hash: String,
    pub url: String,
    pub total_items: i32,
    pub live_count: i32,
    pub movie_count: i32,
    pub series_count: i32,
    pub unknown_count: i32,
    pub group_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl PlaylistRow {
    /// Convert to PlaylistStats for API response
    pub fn to_stats(&self) -> PlaylistStats {
        PlaylistStats {
            total_items: self.total_items as usize,
            live_count: self.live_count as usize,
            movie_count: self.movie_count as usize,
            series_count: self.series_count as usize,
            unknown_count: self.unknown_count as usize,
            group_count: self.group_count as usize,
        }
    }
}

/// Playlist group row from database
#[derive(Debug, Clone, FromRow)]
pub struct GroupRow {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub group_hash: String,
    pub name: String,
    pub media_kind: String,
    pub item_count: i32,
    pub logo: Option<String>,
}

impl From<GroupRow> for PlaylistGroup {
    fn from(row: GroupRow) -> Self {
        PlaylistGroup {
            id: row.group_hash,
            name: row.name,
            media_kind: parse_media_kind(&row.media_kind),
            item_count: row.item_count as usize,
            logo: row.logo,
        }
    }
}

/// Playlist item row from database
#[derive(Debug, Clone, FromRow)]
pub struct ItemRow {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub item_hash: String,
    pub name: String,
    pub url: String,
    pub logo: Option<String>,
    pub group_name: String,
    pub media_kind: String,
    pub parsed_title: Option<String>,
    pub parsed_year: Option<i16>,
    pub parsed_quality: Option<String>,
    pub series_id: Option<String>,
    pub season_number: Option<i16>,
    pub episode_number: Option<i16>,
    pub sort_order: i32,
}

impl From<ItemRow> for PlaylistItem {
    fn from(row: ItemRow) -> Self {
        let parsed_title = row.parsed_title.map(|title| ParsedTitle {
            title,
            year: row.parsed_year.map(|y| y as u16),
            season: row.season_number.map(|s| s as u8),
            episode: row.episode_number.map(|e| e as u16),
            quality: row.parsed_quality.clone(),
            ..Default::default()
        });

        PlaylistItem {
            id: row.item_hash,
            name: row.name,
            url: row.url,
            logo: row.logo,
            group: row.group_name,
            media_kind: parse_media_kind(&row.media_kind),
            parsed_title,
            epg_id: None,
            series_id: row.series_id,
            season_number: row.season_number.map(|s| s as u8),
            episode_number: row.episode_number.map(|e| e as u16),
        }
    }
}

/// Series row from database
#[derive(Debug, Clone, FromRow)]
pub struct SeriesRow {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub series_hash: String,
    pub name: String,
    pub logo: Option<String>,
    pub group_name: String,
    pub total_episodes: i32,
    pub total_seasons: i32,
    pub first_season: Option<i16>,
    pub last_season: Option<i16>,
    pub year: Option<i16>,
    pub quality: Option<String>,
}

impl From<SeriesRow> for SeriesInfo {
    fn from(row: SeriesRow) -> Self {
        SeriesInfo {
            id: row.series_hash,
            name: row.name,
            logo: row.logo,
            group: row.group_name,
            total_episodes: row.total_episodes as usize,
            total_seasons: row.total_seasons as usize,
            first_season: row.first_season.unwrap_or(1) as u16,
            last_season: row.last_season.unwrap_or(1) as u16,
            year: row.year.map(|y| y as u16),
            quality: row.quality,
            seasons_data: None,
        }
    }
}

/// Series episode row from database
#[derive(Debug, Clone, FromRow)]
pub struct EpisodeRow {
    pub id: Uuid,
    pub series_id: Uuid,
    pub item_id: Option<Uuid>,
    pub item_hash: String,
    pub season: i16,
    pub episode: i16,
    pub name: String,
    pub url: String,
}

impl From<EpisodeRow> for SeriesEpisode {
    fn from(row: EpisodeRow) -> Self {
        SeriesEpisode {
            item_id: row.item_hash,
            season: row.season as u8,
            episode: row.episode as u16,
            name: row.name,
            url: row.url,
        }
    }
}

// ============================================================================
// Insert/Write Types (for batch inserts)
// ============================================================================

/// New playlist to insert
#[derive(Debug, Clone)]
pub struct NewPlaylist {
    pub client_id: Option<Uuid>,
    pub hash: String,
    pub url: String,
    pub stats: PlaylistStats,
}

/// New group to insert
#[derive(Debug, Clone)]
pub struct NewGroup {
    pub playlist_id: Uuid,
    pub group_hash: String,
    pub name: String,
    pub media_kind: String,
    pub item_count: i32,
    pub logo: Option<String>,
}

/// New item to insert (for COPY protocol)
#[derive(Debug, Clone)]
pub struct NewItem {
    pub playlist_id: Uuid,
    pub item_hash: String,
    pub name: String,
    pub url: String,
    pub logo: Option<String>,
    pub group_name: String,
    pub media_kind: String,
    pub parsed_title: Option<String>,
    pub parsed_year: Option<i16>,
    pub parsed_quality: Option<String>,
    pub series_id: Option<String>,
    pub season_number: Option<i16>,
    pub episode_number: Option<i16>,
    pub sort_order: i32,
}

impl NewItem {
    /// Create from PlaylistItem
    pub fn from_item(item: &PlaylistItem, playlist_id: Uuid, sort_order: i32) -> Self {
        NewItem {
            playlist_id,
            item_hash: item.id.clone(),
            name: item.name.clone(),
            url: item.url.clone(),
            logo: item.logo.clone(),
            group_name: item.group.clone(),
            media_kind: item.media_kind.to_string(),
            parsed_title: item.parsed_title.as_ref().map(|p| p.title.clone()),
            parsed_year: item.parsed_title.as_ref().and_then(|p| p.year.map(|y| y as i16)),
            parsed_quality: item.parsed_title.as_ref().and_then(|p| p.quality.clone()),
            series_id: item.series_id.clone(),
            season_number: item.season_number.map(|s| s as i16),
            episode_number: item.episode_number.map(|e| e as i16),
            sort_order,
        }
    }
}

/// New series to insert
#[derive(Debug, Clone)]
pub struct NewSeries {
    pub playlist_id: Uuid,
    pub series_hash: String,
    pub name: String,
    pub logo: Option<String>,
    pub group_name: String,
    pub total_episodes: i32,
    pub total_seasons: i32,
    pub first_season: Option<i16>,
    pub last_season: Option<i16>,
    pub year: Option<i16>,
    pub quality: Option<String>,
}

impl NewSeries {
    /// Create from SeriesInfo
    pub fn from_series_info(series: &SeriesInfo, playlist_id: Uuid) -> Self {
        NewSeries {
            playlist_id,
            series_hash: series.id.clone(),
            name: series.name.clone(),
            logo: series.logo.clone(),
            group_name: series.group.clone(),
            total_episodes: series.total_episodes as i32,
            total_seasons: series.total_seasons as i32,
            first_season: Some(series.first_season as i16),
            last_season: Some(series.last_season as i16),
            year: series.year.map(|y| y as i16),
            quality: series.quality.clone(),
        }
    }
}

/// New episode to insert
#[derive(Debug, Clone)]
pub struct NewEpisode {
    pub series_id: Uuid,
    pub item_id: Option<Uuid>,
    pub item_hash: String,
    pub season: i16,
    pub episode: i16,
    pub name: String,
    pub url: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse media kind string to enum
fn parse_media_kind(s: &str) -> MediaKind {
    match s.to_lowercase().as_str() {
        "live" => MediaKind::Live,
        "movie" => MediaKind::Movie,
        "series" => MediaKind::Series,
        _ => MediaKind::Unknown,
    }
}

/// Format item for COPY protocol (tab-separated values)
pub fn format_copy_line(item: &NewItem) -> String {
    // UUID, playlist_id, item_hash, name, url, logo, group_name, media_kind,
    // parsed_title, parsed_year, parsed_quality, series_id, season_number, episode_number, sort_order
    let escape = |s: &str| s.replace('\t', " ").replace('\n', " ").replace('\r', "");

    format!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
        Uuid::new_v4(),
        item.playlist_id,
        escape(&item.item_hash),
        escape(&item.name),
        escape(&item.url),
        item.logo.as_ref().map(|s| escape(s)).unwrap_or_else(|| "\\N".to_string()),
        escape(&item.group_name),
        escape(&item.media_kind),
        item.parsed_title.as_ref().map(|s| escape(s)).unwrap_or_else(|| "\\N".to_string()),
        item.parsed_year.map(|y| y.to_string()).unwrap_or_else(|| "\\N".to_string()),
        item.parsed_quality.as_ref().map(|s| escape(s)).unwrap_or_else(|| "\\N".to_string()),
        item.series_id.as_ref().map(|s| escape(s)).unwrap_or_else(|| "\\N".to_string()),
        item.season_number.map(|s| s.to_string()).unwrap_or_else(|| "\\N".to_string()),
        item.episode_number.map(|e| e.to_string()).unwrap_or_else(|| "\\N".to_string()),
        item.sort_order,
    )
}
