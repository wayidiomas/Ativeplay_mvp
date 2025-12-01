use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db;
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

    // Check if we have valid cache (PostgreSQL)
    // Only consider cache valid if it has items (not an empty/failed parse)
    if let Ok(Some(meta)) = state.db_cache.get_metadata(&hash).await {
        if meta.stats.total_items > 0 {
            tracing::info!("Cache hit for {} ({} items)", hash, meta.stats.total_items);
            return Ok(Json(BackgroundParseResponse {
                status: "complete".to_string(),
                hash,
                message: None,
                stats: Some(meta.stats),
                groups: Some(meta.groups),
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

/// GET /api/playlist/:hash/groups - Get all groups
pub async fn get_groups(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Get groups from PostgreSQL
    let groups = state.db_cache.get_groups(&hash).await.map_err(|e| {
        tracing::error!("Failed to get groups: {}", e);
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
        )
    })?;

    Ok(Json(GroupsResponse {
        total: groups.len(),
        groups,
    }))
}

/// GET /api/playlist/:hash/series - Get all series
pub async fn get_series(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Get series from PostgreSQL
    let series = state.db_cache.get_series(&hash).await.map_err(|e| {
        tracing::error!("Failed to get series: {}", e);
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Playlist não encontrada ou expirada" })),
        )
    })?;

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

        Ok(Json(serde_json::json!({
            "seriesName": series.name,
            "seasonsData": seasons_data,
            "episodes": paginated,
            "total": total,
            "limit": query.limit,
            "offset": query.offset,
            "hasMore": has_more
        })))
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
            match db::get_playlist_by_hash(&state.pool, &hash).await {
                Ok(Some(playlist)) => {
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
