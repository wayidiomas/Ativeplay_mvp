//! Watch history API endpoints
//!
//! Provides endpoints for syncing and retrieving watch history.
//! Watch history is tied to device_id, not playlist, so it persists
//! across playlist changes.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::repository::watch_history;
use crate::AppState;

/// Request to sync watch history
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncHistoryRequest {
    pub device_id: String,
    pub items: Vec<watch_history::WatchHistoryItem>,
}

/// Response for sync operation
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    pub success: bool,
    pub synced: usize,
}

/// Query params for getting history
#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    50
}

/// Response for get history
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub items: Vec<watch_history::WatchHistoryItem>,
    pub total: usize,
}

/// POST /api/watch-history/sync - Sync watch history items from client
pub async fn sync_watch_history(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SyncHistoryRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate device_id
    if payload.device_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "device_id is required" })),
        ));
    }

    // Sync items to database
    let synced = watch_history::sync_items(&state.pool, &payload.device_id, &payload.items)
        .await
        .map_err(|e| {
            tracing::error!("Failed to sync watch history: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to sync watch history" })),
            )
        })?;

    tracing::info!(
        "Synced {} watch history items for device {}",
        synced,
        payload.device_id
    );

    Ok(Json(SyncResponse {
        success: true,
        synced,
    }))
}

/// GET /api/watch-history/:device_id - Get watch history for a device
pub async fn get_watch_history(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate device_id
    if device_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "device_id is required" })),
        ));
    }

    // Apply limit (max 100)
    let limit = query.limit.min(100);

    // Get history from database
    let rows = watch_history::get_recent(&state.pool, &device_id, limit)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get watch history: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get watch history" })),
            )
        })?;

    let items: Vec<watch_history::WatchHistoryItem> = rows.into_iter().map(Into::into).collect();
    let total = items.len();

    Ok(Json(HistoryResponse { items, total }))
}

/// DELETE /api/watch-history/:device_id - Clear watch history for a device
pub async fn clear_watch_history(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate device_id
    if device_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "device_id is required" })),
        ));
    }

    // Delete history from database
    let deleted = watch_history::delete_by_device(&state.pool, &device_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to clear watch history: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to clear watch history" })),
            )
        })?;

    tracing::info!(
        "Cleared {} watch history items for device {}",
        deleted,
        device_id
    );

    Ok(Json(serde_json::json!({
        "success": true,
        "deleted": deleted
    })))
}

/// DELETE /api/watch-history/:device_id/:item_hash - Delete a specific history item
pub async fn delete_history_item(
    State(state): State<Arc<AppState>>,
    Path((device_id, item_hash)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate inputs
    if device_id.is_empty() || item_hash.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "device_id and item_hash are required" })),
        ));
    }

    // Delete item from database
    let deleted = watch_history::delete_item(&state.pool, &device_id, &item_hash)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete history item: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to delete history item" })),
            )
        })?;

    Ok(Json(serde_json::json!({
        "success": deleted > 0,
        "deleted": deleted
    })))
}
