use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx;
use std::sync::Arc;

use crate::db;
use crate::db::repository::playlists;
use crate::models::{GroupsResponse, ItemsQuery, ItemsResponse, ParseRequest, ParseResponse, SeriesResponse};
use crate::services::m3u_parser::hash_url;
use crate::services::redis::ParseProgress;
use crate::AppState;

/// Background parse response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundParseResponse {
    pub status: String,
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<crate::models::PlaylistStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<crate::models::PlaylistGroup>>,
}

/// POST /api/playlist/parse - Parse a playlist URL (background processing)
/// Returns immediately with status "parsing" and spawns background task
/// Frontend should poll /api/playlist/:hash/status for progress
///
/// Features:
/// - Single playlist per device: If device_id is provided, deletes any existing playlist for that device
/// - Smart re-import: If the same URL hash already exists, reuses cached data instead of re-parsing
/// - TTL: All playlists expire after 1 day
pub async fn parse_playlist(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ParseRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate URL
    if payload.url.is_empty() || !payload.url.starts_with("http") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "URL inválida" })),
        ));
    }

    let hash = hash_url(&payload.url);
    let device_id = payload.device_id.as_deref();

    // Single playlist per device: Delete any existing playlist for this device
    if let Some(did) = device_id {
        match playlists::delete_by_device(&state.pool, did).await {
            Ok(deleted) if deleted > 0 => {
                tracing::info!("Deleted {} existing playlist(s) for device {}", deleted, did);
            }
            Err(e) => {
                tracing::warn!("Failed to delete existing playlist for device {}: {}", did, e);
            }
            _ => {}
        }
    }

    // Check if already parsing (via Redis progress)
    if let Ok(Some(progress)) = state.redis.get_parse_progress(&hash).await {
        if progress.status == "parsing" || progress.status == "building_groups" {
            tracing::info!("Already parsing {}", hash);
            return Ok(Json(BackgroundParseResponse {
                status: "parsing".to_string(),
                hash,
                message: Some("Already parsing this playlist".to_string()),
                stats: None,
                groups: None,
            }));
        }
    }

    // Smart re-import: Check if we have valid cache (PostgreSQL)
    // If the hash exists (from any device), reuse the data instead of re-parsing
    if let Ok(Some(existing)) = playlists::find_by_hash_any(&state.pool, &hash).await {
        if existing.total_items > 0 {
            // Update device_id and TTL for the existing playlist
            if let Some(did) = device_id {
                let expires_at = Utc::now() + Duration::days(1);
                if let Err(e) = playlists::update_device_and_ttl(&state.pool, existing.id, did, expires_at).await {
                    tracing::warn!("Failed to update device_id for playlist {}: {}", hash, e);
                } else {
                    tracing::info!("Reusing cached playlist {} for device {}", hash, did);
                }
            }

            // Get groups for response
            let groups = state.db_cache.get_groups(&hash).await.unwrap_or_default();

            return Ok(Json(BackgroundParseResponse {
                status: "complete".to_string(),
                hash,
                message: Some("Loaded from cache".to_string()),
                stats: Some(existing.to_stats()),
                groups: Some(groups),
            }));
        } else {
            tracing::warn!("Found empty cache for {}, will re-parse", hash);
            // Delete the empty playlist to start fresh
            let _ = state.db_cache.delete_playlist(&hash).await;
        }
    }

    // Initialize progress in Redis
    let initial_progress = ParseProgress::new_parsing();
    if let Err(e) = state.redis.set_parse_progress(&hash, &initial_progress).await {
        tracing::warn!("Failed to set initial progress: {}", e);
    }

    // Spawn background parsing task
    let state_clone = state.clone();
    let url_clone = payload.url.clone();
    let hash_clone = hash.clone();
    let device_id_clone = payload.device_id.clone();

    tokio::spawn(async move {
        tracing::info!("Background parse started for {}", hash_clone);

        // Acquire processing lock (10 minute TTL for large playlists)
        let job_id = uuid::Uuid::new_v4().to_string();
        if !state_clone
            .redis
            .acquire_processing_lock(&hash_clone, &job_id, 600)
            .await
            .unwrap_or(false)
        {
            tracing::warn!("Failed to acquire lock for {}", hash_clone);
            let progress = ParseProgress::new_parsing().failed("Failed to acquire lock");
            let _ = state_clone.redis.set_parse_progress(&hash_clone, &progress).await;
            return;
        }

        // Parse and cache the playlist with progress reporting
        match state_clone.parser.parse_and_cache_with_progress(&url_clone, &state_clone.redis).await {
            Ok(metadata) => {
                // Release processing lock
                let _ = state_clone.redis.release_processing_lock(&hash_clone).await;

                // Update playlist with device_id and 1-day TTL
                let expires_at = Utc::now() + Duration::days(1);
                if let Ok(Some(playlist)) = playlists::find_by_hash_any(&state_clone.pool, &hash_clone).await {
                    if let Some(did) = &device_id_clone {
                        if let Err(e) = playlists::update_device_and_ttl(&state_clone.pool, playlist.id, did, expires_at).await {
                            tracing::warn!("Failed to set device_id and TTL for {}: {}", hash_clone, e);
                        } else {
                            tracing::info!("Set device_id {} and 1-day TTL for playlist {}", did, hash_clone);
                        }
                    } else {
                        // No device_id, but still set 1-day TTL
                        let _ = sqlx::query("UPDATE playlists SET expires_at = $2, updated_at = NOW() WHERE id = $1")
                            .bind(playlist.id)
                            .bind(expires_at)
                            .execute(&state_clone.pool)
                            .await;
                        tracing::info!("Set 1-day TTL for playlist {} (no device)", hash_clone);
                    }
                }

                // Mark progress as complete
                let mut progress = ParseProgress::new_parsing();
                progress.items_parsed = metadata.stats.total_items as u64;
                progress.items_total = Some(metadata.stats.total_items as u64);
                let progress = progress.complete(metadata.stats.group_count as u64, metadata.stats.series_count as u64);
                let _ = state_clone.redis.set_parse_progress(&hash_clone, &progress).await;

                tracing::info!(
                    "Background parse complete for {}: {} items, {} groups",
                    hash_clone,
                    metadata.stats.total_items,
                    metadata.stats.group_count
                );
            }
            Err(e) => {
                // Release processing lock
                let _ = state_clone.redis.release_processing_lock(&hash_clone).await;

                // Mark progress as failed
                let progress = ParseProgress::new_parsing().failed(&e.to_string());
                let _ = state_clone.redis.set_parse_progress(&hash_clone, &progress).await;

                tracing::error!("Background parse failed for {}: {}", hash_clone, e);
            }
        }
    });

    // Return immediately
    Ok(Json(BackgroundParseResponse {
        status: "parsing".to_string(),
        hash,
        message: Some("Parsing started in background".to_string()),
        stats: None,
        groups: None,
    }))
}

/// GET /api/playlist/:hash/items - Get paginated items
pub async fn get_items(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
    Query(query): Query<ItemsQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Check if cache exists (PostgreSQL)
    if !state.db_cache.has_cache(&hash).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
        ));
    }

    // Apply limits
    let limit = query.limit.min(state.config.max_items_page);
    let offset = query.offset;

    // Get items with filters (PostgreSQL)
    let (items, total) = state
        .db_cache
        .read_items(
            &hash,
            offset,
            limit,
            query.group.as_deref(),
            query.media_kind.as_deref(),
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to get items: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao buscar itens" })),
            )
        })?;

    let has_more = offset + items.len() < total;

    Ok(Json(ItemsResponse {
        items,
        total,
        limit,
        offset,
        has_more,
    }))
}

/// Query params for groups
#[derive(Deserialize, Default)]
pub struct GroupsQuery {
    /// Filter by media kind (movie, series, live)
    pub media_kind: Option<String>,
}

/// GET /api/playlist/:hash/groups - Get all groups (optionally filtered by media_kind)
pub async fn get_groups(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
    Query(query): Query<GroupsQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Get groups from PostgreSQL (filtered if media_kind is provided)
    let groups = if let Some(media_kind) = &query.media_kind {
        state
            .db_cache
            .get_groups_by_kind(&hash, media_kind)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get groups by kind: {}", e);
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
                )
            })?
    } else {
        state.db_cache.get_groups(&hash).await.map_err(|e| {
            tracing::error!("Failed to get groups: {}", e);
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
            )
        })?
    };

    Ok(Json(GroupsResponse {
        total: groups.len(),
        groups,
    }))
}

/// Query params for series
#[derive(Deserialize, Default)]
pub struct SeriesQuery {
    /// Filter by group name
    pub group: Option<String>,
}

/// GET /api/playlist/:hash/series - Get all series (optionally filtered by group)
pub async fn get_series(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
    Query(query): Query<SeriesQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Get series from PostgreSQL (filtered if group is provided)
    let series = if let Some(group) = &query.group {
        state
            .db_cache
            .get_series_by_group(&hash, group)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get series by group: {}", e);
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
                )
            })?
    } else {
        state.db_cache.get_series(&hash).await.map_err(|e| {
            tracing::error!("Failed to get series: {}", e);
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
            )
        })?
    };

    Ok(Json(SeriesResponse {
        total: series.len(),
        series,
    }))
}

/// GET /api/playlist/:hash/stats - Get playlist stats
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Get metadata from PostgreSQL
    let metadata = state.db_cache.get_metadata(&hash).await.map_err(|e| {
        tracing::error!("Failed to get stats: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Erro ao buscar estatísticas" })),
        )
    })?.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
        )
    })?;

    Ok(Json(serde_json::json!({
        "hash": metadata.hash,
        "stats": metadata.stats,
        "createdAt": metadata.created_at,
        "expiresAt": metadata.expires_at
    })))
}

/// Response for validate endpoint
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResponse {
    pub valid: bool,
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<crate::models::PlaylistStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
}

/// GET /api/playlist/:hash/validate - Check if cache is valid
/// Returns cache status without full data - useful for auto-resume on TV restart
pub async fn validate_cache(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    // Get metadata from PostgreSQL
    match state.db_cache.get_metadata(&hash).await {
        Ok(Some(metadata)) => {
            let now = chrono::Utc::now().timestamp_millis();
            let is_expired = metadata.expires_at <= now;

            Json(ValidateResponse {
                valid: !is_expired,
                hash: metadata.hash,
                url: Some(metadata.url),
                stats: Some(metadata.stats),
                expires_at: Some(metadata.expires_at),
                created_at: Some(metadata.created_at),
            })
        }
        _ => Json(ValidateResponse {
            valid: false,
            hash,
            url: None,
            stats: None,
            expires_at: None,
            created_at: None,
        }),
    }
}

/// Query params for series episodes
#[derive(Deserialize)]
pub struct SeriesEpisodesQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

/// Query params for search
#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    100
}

fn default_search_limit() -> usize {
    50
}

/// GET /api/playlist/:hash/series/:series_id/episodes - Get episodes for a series
pub async fn get_series_episodes(
    State(state): State<Arc<AppState>>,
    Path((hash, series_id)): Path<(String, String)>,
    Query(query): Query<SeriesEpisodesQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Check if cache exists (PostgreSQL)
    if !state.db_cache.has_cache(&hash).await {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
        ));
    }

    // Get series detail with episodes from PostgreSQL
    let series = state
        .db_cache
        .get_series_detail(&hash, &series_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get series detail: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao buscar episódios" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Série não encontrada" })),
            )
        })?;

    if let Some(ref seasons_data) = series.seasons_data {
        // Return pre-sorted episodes from database
        let all_episodes: Vec<_> = seasons_data
            .iter()
            .flat_map(|season| season.episodes.iter().cloned())
            .collect();

        let total = all_episodes.len();
        let paginated: Vec<_> = all_episodes
            .into_iter()
            .skip(query.offset)
            .take(query.limit)
            .collect();

        let has_more = query.offset + paginated.len() < total;

        // Only include seasonsData on first page (offset = 0) to save bandwidth
        // Frontend caches this data after the first request
        let response = if query.offset == 0 {
            serde_json::json!({
                "seriesName": series.name,
                "seasonsData": seasons_data,
                "episodes": paginated,
                "total": total,
                "limit": query.limit,
                "offset": query.offset,
                "hasMore": has_more
            })
        } else {
            serde_json::json!({
                "seriesName": series.name,
                "episodes": paginated,
                "total": total,
                "limit": query.limit,
                "offset": query.offset,
                "hasMore": has_more
            })
        };

        Ok(Json(response))
    } else {
        // No episodes found
        Ok(Json(serde_json::json!({
            "seriesName": series.name,
            "seasonsData": [],
            "episodes": [],
            "total": 0,
            "limit": query.limit,
            "offset": query.offset,
            "hasMore": false
        })))
    }
}

/// GET /api/playlist/:hash/search - Fuzzy search items
/// Uses PostgreSQL pg_trgm for efficient fuzzy matching
pub async fn search_items(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate query
    if query.q.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Query parameter 'q' is required" })),
        ));
    }

    // Apply limit
    let limit = query.limit.min(100);

    // Search using DbCacheService (PostgreSQL fuzzy search)
    let items = state
        .db_cache
        .search_items(&hash, &query.q, limit)
        .await
        .map_err(|e| {
            tracing::error!("Search failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao buscar itens" })),
            )
        })?;

    Ok(Json(serde_json::json!({
        "items": items,
        "query": query.q,
        "total": items.len(),
        "limit": limit
    })))
}

/// Response for parse status endpoint
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseStatusResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items_parsed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub can_navigate: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<i64>,
}

/// GET /api/playlist/:hash/status - Get real-time parsing status
/// Used by frontend for polling during playlist parsing
pub async fn get_parse_status(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    // Check Redis for active progress
    match state.redis.get_parse_progress(&hash).await {
        Ok(Some(progress)) => {
            let now = chrono::Utc::now().timestamp_millis();
            let can_navigate = progress.items_parsed >= 500 || progress.status == "complete";

            Json(ParseStatusResponse {
                status: progress.status,
                items_parsed: Some(progress.items_parsed),
                items_total: progress.items_total,
                groups_count: Some(progress.groups_count),
                series_count: Some(progress.series_count),
                current_phase: Some(progress.current_phase),
                error: progress.error,
                can_navigate,
                elapsed_ms: Some(now - progress.started_at),
            })
        }
        Ok(None) => {
            // Check if playlist exists in DB (already complete from previous parse)
            // Only consider it complete if it actually has items
            match db::get_playlist_by_hash(&state.pool, &hash).await {
                Ok(Some(playlist)) if playlist.total_items > 0 => {
                    Json(ParseStatusResponse {
                        status: "complete".to_string(),
                        items_parsed: Some(playlist.total_items as u64),
                        items_total: Some(playlist.total_items as u64),
                        groups_count: Some(playlist.group_count as u64),
                        series_count: Some(playlist.series_count as u64),
                        current_phase: Some("done".to_string()),
                        error: None,
                        can_navigate: true,
                        elapsed_ms: None,
                    })
                }
                _ => {
                    Json(ParseStatusResponse {
                        status: "not_found".to_string(),
                        items_parsed: None,
                        items_total: None,
                        groups_count: None,
                        series_count: None,
                        current_phase: None,
                        error: Some("Playlist not found or not started".to_string()),
                        can_navigate: false,
                        elapsed_ms: None,
                    })
                }
            }
        }
        Err(e) => {
            Json(ParseStatusResponse {
                status: "error".to_string(),
                items_parsed: None,
                items_total: None,
                groups_count: None,
                series_count: None,
                current_phase: None,
                error: Some(e.to_string()),
                can_navigate: false,
                elapsed_ms: None,
            })
        }
    }
}
