//! Xtream Codes Proxy Routes
//!
//! These routes act as a proxy between the frontend and Xtream Codes servers.
//! They consume the Xtream Player API directly using stored credentials.
//!
//! Normalization features (inspired by @iptv/xtream-api):
//! - Cast/Genre as arrays instead of comma-separated strings
//! - Rating as f32 instead of string
//! - Timestamps as ISO8601 strings
//! - Base64 decoding for EPG data
//! - Auto-generate seasons from episodes when missing

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::db::models::SourceType;
use crate::db::repository::playlists;
use crate::services::xtream::{
    decode_base64_if_needed, generate_seasons_from_episodes, parse_duration_to_secs,
    parse_rating, split_csv, timestamp_to_iso, XtreamClient, XtreamCredentials,
};
use crate::AppState;

// ============================================================================
// Query Parameters
// ============================================================================

#[derive(Deserialize, Default)]
pub struct StreamsQuery {
    pub category_id: Option<String>,
}

#[derive(Deserialize)]
pub struct PlayUrlQuery {
    pub stream_id: i64,
    pub media_type: String,
    pub extension: Option<String>,
    /// Optional format override for live streams (ts/m3u8/rtmp)
    pub format: Option<String>,
}

#[derive(Deserialize)]
pub struct EpgQuery {
    pub limit: Option<i32>,
}

#[derive(Deserialize)]
pub struct TimeshiftQuery {
    pub stream_id: i64,
    /// Start time as Unix timestamp
    pub start: i64,
    /// Duration in minutes
    pub duration: i32,
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(Serialize)]
pub struct CategoriesResponse {
    pub total: usize,
    pub categories: Vec<CategoryItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryItem {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamsResponse {
    pub total: usize,
    pub items: Vec<StreamItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamItem {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    pub media_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    /// Normalized rating as f32 (0-10 scale)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg_channel_id: Option<String>,
    /// Timestamp when added (ISO8601)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    /// Whether channel has TV archive/catchup support
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tv_archive: Option<bool>,
    /// TV archive duration in days
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tv_archive_duration: Option<i32>,
}

#[derive(Serialize)]
pub struct PlayUrlResponse {
    pub url: String,
}

// ============================================================================
// Normalized VOD Info Response (inspired by @iptv/xtream-api)
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedVodInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backdrop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    /// Cast as array instead of comma-separated string
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cast: Vec<String>,
    /// Director as array (some have multiple directors)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub directors: Vec<String>,
    /// Genres as array instead of comma-separated string
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    /// Rating as f32 (0-10 scale)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f32>,
    /// Duration in seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youtube_trailer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_extension: Option<String>,
    /// Stream ID for playback URL generation
    pub stream_id: i64,
}

// ============================================================================
// Normalized Series Info Response (inspired by @iptv/xtream-api)
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSeriesInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backdrop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    /// Cast as array
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cast: Vec<String>,
    /// Directors as array
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub directors: Vec<String>,
    /// Genres as array
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    /// Rating as f32 (0-10 scale)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youtube_trailer: Option<String>,
    /// Seasons (auto-generated from episodes if empty)
    pub seasons: Vec<NormalizedSeason>,
    /// Episodes grouped by season number
    pub episodes: HashMap<String, Vec<NormalizedEpisode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSeason {
    pub season_number: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub air_date: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedEpisode {
    pub id: String,
    pub episode_num: i32,
    pub title: String,
    pub container_extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    /// Duration in seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    /// Rating as f32
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XtreamPlaylistInfo {
    pub id: String,
    pub name: String,
    pub server: String,
    pub username: String,
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_connections: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_trial: Option<bool>,
}

// ============================================================================
// Helper Functions
// ============================================================================

fn parse_uuid(s: &str) -> Result<Uuid, (StatusCode, Json<serde_json::Value>)> {
    Uuid::parse_str(s).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid playlist ID format"})),
        )
    })
}

async fn get_xtream_credentials(
    pool: &sqlx::PgPool,
    playlist_id: Uuid,
) -> Result<(XtreamCredentials, crate::db::models::PlaylistRow), (StatusCode, Json<serde_json::Value>)> {
    let playlist = playlists::find_by_id(pool, playlist_id)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Playlist not found"})),
            )
        })?;

    if playlist.source_type != Some(SourceType::Xtream) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Not an Xtream playlist"})),
        ));
    }

    let server = playlist.xtream_server.clone().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing Xtream server"})),
        )
    })?;
    let username = playlist.xtream_username.clone().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing Xtream username"})),
        )
    })?;
    let password = playlist.xtream_password.clone().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing Xtream password"})),
        )
    })?;

    Ok((
        XtreamCredentials {
            server,
            username,
            password,
            preferred_live_format: "ts".to_string(),
        },
        playlist,
    ))
}

// ============================================================================
// Route Handlers
// ============================================================================

/// GET /api/xtream/:playlist_id/info
pub async fn get_playlist_info(
    State(state): State<Arc<AppState>>,
    Path(playlist_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let (creds, playlist) = get_xtream_credentials(&state.pool, playlist_uuid).await?;

    Ok(Json(XtreamPlaylistInfo {
        id: playlist_uuid.to_string(),
        name: playlist.name.unwrap_or_else(|| "Xtream Playlist".to_string()),
        server: creds.server,
        username: creds.username,
        source_type: "xtream".to_string(),
        expires_at: playlist.xtream_expires_at.map(|dt| dt.timestamp()),
        max_connections: playlist.xtream_max_connections,
        is_trial: playlist.xtream_is_trial,
    }))
}

/// GET /api/xtream/:playlist_id/categories/:type
pub async fn get_categories(
    State(state): State<Arc<AppState>>,
    Path((playlist_id, media_type)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;
    let client = XtreamClient::from_credentials(&creds);

    let categories = match media_type.as_str() {
        "live" => client.get_live_categories().await,
        "vod" => client.get_vod_categories().await,
        "series" => client.get_series_categories().await,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid media type. Use: live, vod, or series"})),
            ))
        }
    }
    .map_err(|e| {
        tracing::error!("Xtream API error: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
        )
    })?;

    let items: Vec<CategoryItem> = categories
        .into_iter()
        .map(|c| CategoryItem {
            id: c.category_id,
            name: c.category_name,
            parent_id: c.parent_id,
        })
        .collect();

    Ok(Json(CategoriesResponse {
        total: items.len(),
        categories: items,
    }))
}

/// GET /api/xtream/:playlist_id/streams/:type
pub async fn get_streams(
    State(state): State<Arc<AppState>>,
    Path((playlist_id, media_type)): Path<(String, String)>,
    Query(query): Query<StreamsQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;
    let client = XtreamClient::from_credentials(&creds);

    let items: Vec<StreamItem> = match media_type.as_str() {
        "live" => {
            let streams = if let Some(cat_id) = query.category_id {
                client.get_live_streams_by_category(&cat_id).await
            } else {
                client.get_live_streams().await
            }
            .map_err(|e| {
                tracing::error!("Xtream API error: {}", e);
                (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
                )
            })?;

            streams
                .into_iter()
                .map(|s| StreamItem {
                    id: s.stream_id.to_string(),
                    name: s.name,
                    logo: s.stream_icon,
                    category_id: s.category_id,
                    media_type: "live".to_string(),
                    extension: Some("ts".to_string()),
                    rating: None,
                    epg_channel_id: s.epg_channel_id,
                    added_at: timestamp_to_iso(&s.added),
                    tv_archive: s.tv_archive.map(|v| v == 1),
                    tv_archive_duration: s.tv_archive_duration,
                })
                .collect()
        }
        "vod" => {
            let streams = if let Some(cat_id) = query.category_id {
                client.get_vod_streams_by_category(&cat_id).await
            } else {
                client.get_vod_streams().await
            }
            .map_err(|e| {
                tracing::error!("Xtream API error: {}", e);
                (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
                )
            })?;

            streams
                .into_iter()
                .map(|s| StreamItem {
                    id: s.stream_id.to_string(),
                    name: s.name,
                    logo: s.stream_icon,
                    category_id: s.category_id,
                    media_type: "vod".to_string(),
                    extension: s.container_extension,
                    rating: parse_rating(&s.rating),
                    epg_channel_id: None,
                    added_at: timestamp_to_iso(&s.added),
                    tv_archive: None,
                    tv_archive_duration: None,
                })
                .collect()
        }
        "series" => {
            let series = if let Some(cat_id) = query.category_id {
                client.get_series_by_category(&cat_id).await
            } else {
                client.get_series().await
            }
            .map_err(|e| {
                tracing::error!("Xtream API error: {}", e);
                (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
                )
            })?;

            series
                .into_iter()
                .map(|s| StreamItem {
                    id: s.series_id.to_string(),
                    name: s.name,
                    logo: s.cover,
                    category_id: s.category_id,
                    media_type: "series".to_string(),
                    extension: None,
                    rating: parse_rating(&s.rating),
                    epg_channel_id: None,
                    added_at: None, // Series don't have added timestamp in list
                    tv_archive: None,
                    tv_archive_duration: None,
                })
                .collect()
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid media type. Use: live, vod, or series"})),
            ))
        }
    };

    Ok(Json(StreamsResponse {
        total: items.len(),
        items,
    }))
}

/// GET /api/xtream/:playlist_id/vod/:vod_id
/// Returns normalized VOD info with arrays for cast/genres and numeric rating
pub async fn get_vod_info(
    State(state): State<Arc<AppState>>,
    Path((playlist_id, vod_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let vod_id_num: i64 = vod_id.parse().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid VOD ID"})),
        )
    })?;

    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;
    let client = XtreamClient::from_credentials(&creds);

    let vod_info = client.get_vod_info(vod_id_num).await.map_err(|e| {
        tracing::error!("Xtream API error: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
        )
    })?;

    // Normalize the response (inspired by @iptv/xtream-api)
    let info = &vod_info.info;
    let movie = &vod_info.movie_data;

    // Merge cast and actors fields, split into array
    let cast_str = info.cast.clone().or_else(|| info.actors.clone());
    let cast = split_csv(&cast_str);

    // Parse duration - try duration_secs first, then parse duration string
    let duration_secs = info.duration_secs.or_else(|| parse_duration_to_secs(&info.duration));

    let normalized = NormalizedVodInfo {
        id: movie.stream_id.to_string(),
        name: movie.name.clone(),
        title: info.title.clone().or_else(|| info.name.clone()),
        original_name: info.original_name.clone(),
        year: info.year.clone(),
        release_date: info.releasedate.clone(),
        cover: info.cover_big.clone().or_else(|| info.movie_image.clone()),
        backdrop: info.backdrop_path.clone(),
        plot: info.plot.clone().or_else(|| info.description.clone()),
        cast,
        directors: split_csv(&info.director),
        genres: split_csv(&info.genre),
        rating: parse_rating(&info.rating),
        duration_secs,
        tmdb_id: info.tmdb_id.clone(),
        youtube_trailer: info.youtube_trailer.clone(),
        container_extension: movie.container_extension.clone(),
        stream_id: movie.stream_id,
    };

    Ok(Json(normalized))
}

/// GET /api/xtream/:playlist_id/series/:series_id
/// Returns normalized series info with arrays for cast/genres, numeric rating,
/// and auto-generates seasons from episodes if seasons array is empty
pub async fn get_series_info(
    State(state): State<Arc<AppState>>,
    Path((playlist_id, series_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let series_id_num: i64 = series_id.parse().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid Series ID"})),
        )
    })?;

    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;
    let client = XtreamClient::from_credentials(&creds);

    let series_info = client.get_series_info(series_id_num).await.map_err(|e| {
        tracing::error!("Xtream API error: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
        )
    })?;

    // Normalize the response (inspired by @iptv/xtream-api)
    let info = &series_info.info;

    // Auto-generate seasons from episodes if seasons array is empty/missing
    let seasons_raw = series_info.seasons.as_ref();
    let seasons: Vec<NormalizedSeason> = if seasons_raw.map(|s| s.is_empty()).unwrap_or(true) {
        // Generate seasons from episode keys
        let generated = generate_seasons_from_episodes(&series_info.episodes);
        generated
            .into_iter()
            .map(|s| NormalizedSeason {
                season_number: s.season_number.unwrap_or(1),
                name: s.name,
                cover: s.cover.or_else(|| s.cover_big),
                episode_count: s.episode_count,
                air_date: s.air_date,
            })
            .collect()
    } else {
        seasons_raw
            .unwrap()
            .iter()
            .map(|s| NormalizedSeason {
                season_number: s.season_number.unwrap_or(1),
                name: s.name.clone(),
                cover: s.cover.clone().or_else(|| s.cover_big.clone()),
                episode_count: s.episode_count,
                air_date: s.air_date.clone(),
            })
            .collect()
    };

    // Normalize episodes
    let episodes: HashMap<String, Vec<NormalizedEpisode>> = series_info
        .episodes
        .iter()
        .map(|(season_num, eps)| {
            let normalized_eps: Vec<NormalizedEpisode> = eps
                .iter()
                .map(|ep| {
                    let ep_info = ep.info.as_ref();
                    NormalizedEpisode {
                        id: ep.id.clone(),
                        episode_num: ep.episode_num,
                        title: ep.title.clone(),
                        container_extension: ep.container_extension.clone(),
                        season: ep.season.or_else(|| season_num.parse().ok()),
                        plot: ep_info.and_then(|i| i.plot.clone()),
                        duration_secs: ep_info.and_then(|i| i.duration_secs),
                        cover: ep_info.and_then(|i| i.movie_image.clone()),
                        rating: ep_info.and_then(|i| i.rating),
                        added_at: timestamp_to_iso(&ep.added),
                    }
                })
                .collect();
            (season_num.clone(), normalized_eps)
        })
        .collect();

    let normalized = NormalizedSeriesInfo {
        id: series_id,
        name: info.name.clone().unwrap_or_default(),
        cover: info.cover.clone(),
        backdrop: info.backdrop_path.clone(),
        plot: info.plot.clone(),
        cast: split_csv(&info.cast),
        directors: split_csv(&info.director),
        genres: split_csv(&info.genre),
        rating: parse_rating(&info.rating),
        release_date: info.releaseDate.clone(),
        youtube_trailer: info.youtube_trailer.clone(),
        seasons,
        episodes,
    };

    Ok(Json(normalized))
}

/// GET /api/xtream/:playlist_id/play-url
pub async fn get_play_url(
    State(state): State<Arc<AppState>>,
    Path(playlist_id): Path<String>,
    Query(query): Query<PlayUrlQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;

    let url = match query.media_type.as_str() {
        "live" => {
            let fmt = query
                .format
                .as_deref()
                .or_else(|| query.extension.as_deref());
            creds.live_url_with_format(query.stream_id, fmt)
        }
        "vod" => {
            let ext = query.extension.as_deref().unwrap_or("mp4");
            creds.vod_url(query.stream_id, ext)
        }
        "series" => {
            let ext = query.extension.as_deref().unwrap_or("mp4");
            creds.series_url(query.stream_id, ext)
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid media type. Use: live, vod, or series"})),
            ))
        }
    };

    Ok(Json(PlayUrlResponse { url }))
}

// ============================================================================
// EPG Response Types
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgEntry {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Start time as ISO8601
    pub start: String,
    /// End time as ISO8601
    pub end: String,
    /// Whether this program has archive available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_archive: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgResponse {
    pub stream_id: String,
    pub listings: Vec<EpgEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeshiftUrlResponse {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgUrlResponse {
    pub url: String,
}

// ============================================================================
// EPG & Timeshift Handlers
// ============================================================================

/// GET /api/xtream/:playlist_id/epg/:stream_id
/// Returns short EPG (next ~4 hours) for a live channel
pub async fn get_epg(
    State(state): State<Arc<AppState>>,
    Path((playlist_id, stream_id)): Path<(String, String)>,
    Query(query): Query<EpgQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let stream_id_num: i64 = stream_id.parse().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid stream ID"})),
        )
    })?;

    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;
    let client = XtreamClient::from_credentials(&creds);

    let epg = client
        .get_short_epg(stream_id_num, query.limit)
        .await
        .map_err(|e| {
            tracing::error!("Xtream EPG error: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Xtream API error: {}", e)})),
            )
        })?;

    // Normalize EPG entries - decode base64 titles/descriptions if needed
    // start/end are already formatted times, start_timestamp/stop_timestamp are Unix
    let listings: Vec<EpgEntry> = epg
        .epg_listings
        .into_iter()
        .map(|e| EpgEntry {
            id: e.epg_id,
            title: decode_base64_if_needed(&e.title),
            description: e.description.map(|d| decode_base64_if_needed(&d)),
            start: timestamp_to_iso(&Some(e.start_timestamp.clone())).unwrap_or(e.start),
            end: timestamp_to_iso(&Some(e.stop_timestamp.clone())).unwrap_or(e.end),
            has_archive: e.has_archive.map(|v| v == 1),
        })
        .collect();

    Ok(Json(EpgResponse {
        stream_id,
        listings,
    }))
}

/// GET /api/xtream/:playlist_id/timeshift-url
/// Generates a timeshift URL for catching up on live TV
pub async fn get_timeshift_url(
    State(state): State<Arc<AppState>>,
    Path(playlist_id): Path<String>,
    Query(query): Query<TimeshiftQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;

    // Build timeshift URL
    // Format: http://SERVER/streaming/timeshift.php?username=X&password=Y&stream=ID&start=TIMESTAMP&duration=MINS
    let url = format!(
        "{}/streaming/timeshift.php?username={}&password={}&stream={}&start={}&duration={}",
        creds.server,
        creds.username,
        creds.password,
        query.stream_id,
        query.start,
        query.duration
    );

    Ok(Json(TimeshiftUrlResponse { url }))
}

/// GET /api/xtream/:playlist_id/epg-url
/// Returns the XMLTV EPG URL for the playlist
pub async fn get_epg_url(
    State(state): State<Arc<AppState>>,
    Path(playlist_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let playlist_uuid = parse_uuid(&playlist_id)?;
    let (creds, _) = get_xtream_credentials(&state.pool, playlist_uuid).await?;

    Ok(Json(EpgUrlResponse {
        url: creds.epg_url(),
    }))
}
