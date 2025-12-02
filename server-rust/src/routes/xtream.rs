//! Xtream Codes Proxy Routes
//!
//! These routes act as a proxy between the frontend and Xtream Codes servers.
//! They consume the Xtream Player API directly using stored credentials.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::db::models::SourceType;
use crate::db::repository::playlists;
use crate::services::xtream::{XtreamClient, XtreamCredentials};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg_channel_id: Option<String>,
}

#[derive(Serialize)]
pub struct PlayUrlResponse {
    pub url: String,
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

    Ok((XtreamCredentials { server, username, password }, playlist))
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
                    rating: s.rating,
                    epg_channel_id: None,
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
                    rating: s.rating,
                    epg_channel_id: None,
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

    let json_value = serde_json::to_value(vod_info).map_err(|e| {
        tracing::error!("Serialization error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to serialize response"})),
        )
    })?;

    Ok(Json(json_value))
}

/// GET /api/xtream/:playlist_id/series/:series_id
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

    let json_value = serde_json::to_value(series_info).map_err(|e| {
        tracing::error!("Serialization error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to serialize response"})),
        )
    })?;

    Ok(Json(json_value))
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
        "live" => creds.live_url(query.stream_id),
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
