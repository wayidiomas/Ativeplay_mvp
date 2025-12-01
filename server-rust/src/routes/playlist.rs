use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::{GroupsResponse, ItemsQuery, ItemsResponse, ParseRequest, ParseResponse, SeriesResponse};
use crate::services::m3u_parser::hash_url;
use crate::AppState;

/// POST /api/playlist/parse - Parse a playlist URL
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

    // Check if we have valid cache (PostgreSQL)
    if let Ok(Some(meta)) = state.db_cache.get_metadata(&hash).await {
        tracing::info!("Cache hit for {}", hash);
        return Ok(Json(ParseResponse {
            success: true,
            cached: true,
            hash,
            stats: meta.stats,
            groups: meta.groups,
        }));
    }

    // Check if already being processed (via Redis lock)
    let lock_key = format!("processing:{}", hash);
    if state.redis.exists(&lock_key).await.unwrap_or(false) {
        return Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Playlist already being processed",
                "hash": hash
            })),
        ));
    }

    // Acquire processing lock (5 minute TTL)
    let job_id = uuid::Uuid::new_v4().to_string();
    if !state
        .redis
        .acquire_processing_lock(&hash, &job_id, 300)
        .await
        .unwrap_or(false)
    {
        return Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Playlist already being processed",
                "hash": hash
            })),
        ));
    }

    // Parse and cache the playlist
    match state.parser.parse_and_cache(&payload.url).await {
        Ok(metadata) => {
            // Release processing lock
            let _ = state.redis.release_processing_lock(&hash).await;

            tracing::info!(
                "Playlist parsed: {} items, {} groups",
                metadata.stats.total_items,
                metadata.stats.group_count
            );

            Ok(Json(ParseResponse {
                success: true,
                cached: false,
                hash,
                stats: metadata.stats,
                groups: metadata.groups,
            }))
        }
        Err(e) => {
            // Release processing lock on error
            let _ = state.redis.release_processing_lock(&hash).await;

            tracing::error!("Failed to parse playlist: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Erro ao processar playlist: {}", e),
                    "hash": hash
                })),
            ))
        }
    }
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
