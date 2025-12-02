use serde::{Deserialize, Serialize};

/// Media type classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Live,
    Movie,
    Series,
    Unknown,
}

impl Default for MediaKind {
    fn default() -> Self {
        Self::Unknown
    }
}

impl std::fmt::Display for MediaKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaKind::Live => write!(f, "live"),
            MediaKind::Movie => write!(f, "movie"),
            MediaKind::Series => write!(f, "series"),
            MediaKind::Unknown => write!(f, "unknown"),
        }
    }
}

/// Parsed title metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTitle {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default)]
    pub is_multi_audio: bool,
    #[serde(default)]
    pub is_dubbed: bool,
    #[serde(default)]
    pub is_subbed: bool,
}

/// Extracted series info from title pattern (SxxExx, 1x01, T01E01)
/// Used by classifier when parsing M3U entries
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedSeriesInfo {
    pub series_name: String,
    pub season: u8,
    pub episode: u16,
    pub is_series: bool,
}

/// Single playlist item (channel/movie/episode)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub group: String,
    pub media_kind: MediaKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_title: Option<ParsedTitle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_id: Option<String>,
    /// Season number for series episodes (for sorting)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season_number: Option<u8>,
    /// Episode number for series episodes (for sorting)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<u16>,
}

/// Group/category information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistGroup {
    pub id: String,
    pub name: String,
    pub media_kind: MediaKind,
    pub item_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
}

/// Episode reference within a series (for ordering)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesEpisode {
    pub item_id: String,
    pub season: u8,
    pub episode: u16,
    pub name: String,
    #[serde(default)]
    pub url: String,
}

/// Series metadata (grouped episodes)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub group: String,
    pub total_episodes: usize,
    pub total_seasons: usize,
    pub first_season: u16,
    pub last_season: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<String>,
    /// Episodes grouped by season, sorted by episode number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seasons_data: Option<Vec<SeasonData>>,
}

/// Season data with sorted episodes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonData {
    pub season_number: u8,
    pub episodes: Vec<SeriesEpisode>,
}

/// Playlist statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistStats {
    pub total_items: usize,
    pub live_count: usize,
    pub movie_count: usize,
    pub series_count: usize,
    pub unknown_count: usize,
    pub group_count: usize,
}

/// Cache metadata stored in .meta.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheMetadata {
    pub hash: String,
    pub url: String,
    pub stats: PlaylistStats,
    pub groups: Vec<PlaylistGroup>,
    pub series: Vec<SeriesInfo>,
    pub created_at: i64,
    pub expires_at: i64,
    // Hybrid support: identifies Xtream vs M3U playlists
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_id: Option<String>,
}

/// Request to parse a playlist
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseRequest {
    pub url: String,
    /// Device ID for single-playlist-per-device enforcement
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub options: ParseOptions,
}

/// Parsing options
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOptions {
    #[serde(default = "default_true")]
    pub normalize: bool,
    #[serde(default = "default_true")]
    pub remove_duplicates: bool,
    #[serde(default)]
    pub skip_series_grouping: bool,
}

fn default_true() -> bool {
    true
}

/// Parse response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResponse {
    pub success: bool,
    pub cached: bool,
    pub hash: String,
    pub stats: PlaylistStats,
    pub groups: Vec<PlaylistGroup>,
}

/// Paginated items response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsResponse {
    pub items: Vec<PlaylistItem>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
    pub has_more: bool,
}

/// Groups response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupsResponse {
    pub groups: Vec<PlaylistGroup>,
    pub total: usize,
}

/// Series response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesResponse {
    pub series: Vec<SeriesInfo>,
    pub total: usize,
}

/// Query parameters for items endpoint
#[derive(Debug, Deserialize)]
pub struct ItemsQuery {
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub media_kind: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

fn default_limit() -> usize {
    50
}
