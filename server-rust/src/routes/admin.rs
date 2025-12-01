//! Admin/Management endpoints for database operations

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::db::repository::{groups, items, playlists, series};
use crate::AppState;

/// Query params for admin operations
#[derive(Debug, Deserialize)]
pub struct AdminQuery {
    /// Admin key for authorization (simple protection)
    pub key: Option<String>,
}

/// Response for delete operations
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResponse {
    pub success: bool,
    pub message: String,
    pub deleted: DeletedCounts,
}

/// Counts of deleted records
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedCounts {
    pub playlists: u64,
    pub groups: u64,
    pub items: u64,
    pub series: u64,
}

/// Stats response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatsResponse {
    pub playlists: i64,
    pub groups: i64,
    pub items: i64,
    pub series: i64,
    pub episodes: i64,
}

/// Validate admin key
fn validate_admin_key(state: &AppState, provided_key: Option<&str>) -> bool {
    // Get admin key from config or use default for development
    let admin_key = std::env::var("ADMIN_KEY").unwrap_or_else(|_| "admin123".to_string());

    match provided_key {
        Some(key) => key == admin_key,
        None => false,
    }
}

/// DELETE /api/admin/playlist/:hash - Delete a specific playlist and all its data
pub async fn delete_playlist(
    State(state): State<Arc<AppState>>,
    Path(hash): Path<String>,
    Query(query): Query<AdminQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate admin key
    if !validate_admin_key(&state, query.key.as_deref()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or missing admin key" })),
        ));
    }

    // Find playlist by hash
    let playlist = playlists::find_by_hash_any(&state.pool, &hash)
        .await
        .map_err(|e| {
            tracing::error!("Failed to find playlist: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Database error" })),
            )
        })?;

    let playlist = match playlist {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Playlist not found" })),
            ));
        }
    };

    // Get counts before deletion (for response)
    let group_count = groups::count_by_playlist(&state.pool, playlist.id)
        .await
        .unwrap_or(0) as u64;
    let item_count = items::count_by_playlist(&state.pool, playlist.id)
        .await
        .unwrap_or(0) as u64;
    let series_count = series::count_by_playlist(&state.pool, playlist.id)
        .await
        .unwrap_or(0) as u64;

    // Delete playlist (CASCADE will delete groups, items, series, episodes)
    playlists::delete_playlist(&state.pool, playlist.id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete playlist: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to delete playlist" })),
            )
        })?;

    tracing::info!(
        "Admin: Deleted playlist {} with {} groups, {} items, {} series",
        hash,
        group_count,
        item_count,
        series_count
    );

    Ok(Json(DeleteResponse {
        success: true,
        message: format!("Playlist {} deleted successfully", hash),
        deleted: DeletedCounts {
            playlists: 1,
            groups: group_count,
            items: item_count,
            series: series_count,
        },
    }))
}

/// DELETE /api/admin/all - Delete ALL data (dangerous!)
pub async fn delete_all_data(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AdminQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate admin key
    if !validate_admin_key(&state, query.key.as_deref()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or missing admin key" })),
        ));
    }

    // Get counts before deletion
    let playlist_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("Failed to count playlists: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Database error" })),
            )
        })?;

    let group_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlist_groups")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    let item_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlist_items")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    let series_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM series")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    // Delete all playlists (CASCADE handles the rest)
    sqlx::query("DELETE FROM playlists")
        .execute(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete all data: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to delete data" })),
            )
        })?;

    // Also clear Redis cache
    if let Err(e) = state.redis.flush_db().await {
        tracing::warn!("Failed to flush Redis: {}", e);
    }

    tracing::warn!(
        "Admin: DELETED ALL DATA - {} playlists, {} groups, {} items, {} series",
        playlist_count.0,
        group_count.0,
        item_count.0,
        series_count.0
    );

    Ok(Json(DeleteResponse {
        success: true,
        message: "All data deleted successfully".to_string(),
        deleted: DeletedCounts {
            playlists: playlist_count.0 as u64,
            groups: group_count.0 as u64,
            items: item_count.0 as u64,
            series: series_count.0 as u64,
        },
    }))
}

/// GET /api/admin/stats - Get database statistics
pub async fn get_db_stats(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AdminQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate admin key
    if !validate_admin_key(&state, query.key.as_deref()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or missing admin key" })),
        ));
    }

    let playlist_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    let group_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlist_groups")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    let item_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlist_items")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    let series_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM series")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    let episode_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM series_episodes")
        .fetch_one(&state.pool)
        .await
        .unwrap_or((0,));

    Ok(Json(DbStatsResponse {
        playlists: playlist_count.0,
        groups: group_count.0,
        items: item_count.0,
        series: series_count.0,
        episodes: episode_count.0,
    }))
}

/// DELETE /api/admin/expired - Delete expired playlists
pub async fn delete_expired(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AdminQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate admin key
    if !validate_admin_key(&state, query.key.as_deref()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or missing admin key" })),
        ));
    }

    // Call the cleanup function
    let deleted: (i32,) = sqlx::query_as("SELECT cleanup_expired_playlists()")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("Failed to cleanup expired playlists: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to cleanup expired playlists" })),
            )
        })?;

    tracing::info!("Admin: Cleaned up {} expired playlists", deleted.0);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Cleaned up {} expired playlists", deleted.0),
        "deleted": deleted.0
    })))
}
