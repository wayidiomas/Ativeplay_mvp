//! Watch history repository for database operations
//!
//! Manages persistent watch history tied to device_id (not playlist).
//! This allows "Continue Watching" to persist across playlist changes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Watch history item for sync requests
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryItem {
    pub item_hash: String,
    pub media_kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub position_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    pub watched_at: i64, // Timestamp in milliseconds
}

/// Database row for watch history
#[derive(Debug, Clone, FromRow)]
pub struct WatchHistoryRow {
    pub id: Uuid,
    pub device_id: String,
    pub item_hash: String,
    pub media_kind: String,
    pub name: Option<String>,
    pub logo: Option<String>,
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
    pub watched_at: DateTime<Utc>,
}

impl From<WatchHistoryRow> for WatchHistoryItem {
    fn from(row: WatchHistoryRow) -> Self {
        Self {
            item_hash: row.item_hash,
            media_kind: row.media_kind,
            name: row.name.unwrap_or_default(),
            logo: row.logo,
            position_ms: row.position_ms,
            duration_ms: row.duration_ms,
            watched_at: row.watched_at.timestamp_millis(),
        }
    }
}

/// Upsert (insert or update) a single watch history item
pub async fn upsert_item(
    pool: &PgPool,
    device_id: &str,
    item: &WatchHistoryItem,
) -> Result<(), sqlx::Error> {
    let watched_at = DateTime::from_timestamp_millis(item.watched_at)
        .unwrap_or_else(Utc::now);

    sqlx::query(
        r#"
        INSERT INTO watch_history (device_id, item_hash, media_kind, name, logo, position_ms, duration_ms, watched_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (device_id, item_hash) DO UPDATE SET
            media_kind = EXCLUDED.media_kind,
            name = EXCLUDED.name,
            logo = EXCLUDED.logo,
            position_ms = EXCLUDED.position_ms,
            duration_ms = EXCLUDED.duration_ms,
            watched_at = EXCLUDED.watched_at
        "#,
    )
    .bind(device_id)
    .bind(&item.item_hash)
    .bind(&item.media_kind)
    .bind(&item.name)
    .bind(&item.logo)
    .bind(item.position_ms)
    .bind(item.duration_ms)
    .bind(watched_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Sync multiple watch history items at once
pub async fn sync_items(
    pool: &PgPool,
    device_id: &str,
    items: &[WatchHistoryItem],
) -> Result<usize, sqlx::Error> {
    let mut count = 0;

    for item in items {
        upsert_item(pool, device_id, item).await?;
        count += 1;
    }

    Ok(count)
}

/// Get recent watch history for a device (sorted by most recent first)
pub async fn get_recent(
    pool: &PgPool,
    device_id: &str,
    limit: i64,
) -> Result<Vec<WatchHistoryRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, WatchHistoryRow>(
        r#"
        SELECT id, device_id, item_hash, media_kind, name, logo, position_ms, duration_ms, watched_at
        FROM watch_history
        WHERE device_id = $1
        ORDER BY watched_at DESC
        LIMIT $2
        "#,
    )
    .bind(device_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get a specific watch history item by hash
pub async fn get_by_hash(
    pool: &PgPool,
    device_id: &str,
    item_hash: &str,
) -> Result<Option<WatchHistoryRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, WatchHistoryRow>(
        r#"
        SELECT id, device_id, item_hash, media_kind, name, logo, position_ms, duration_ms, watched_at
        FROM watch_history
        WHERE device_id = $1 AND item_hash = $2
        "#,
    )
    .bind(device_id)
    .bind(item_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Delete watch history for a device
pub async fn delete_by_device(
    pool: &PgPool,
    device_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM watch_history WHERE device_id = $1")
        .bind(device_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Delete a specific watch history item
pub async fn delete_item(
    pool: &PgPool,
    device_id: &str,
    item_hash: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM watch_history WHERE device_id = $1 AND item_hash = $2")
        .bind(device_id)
        .bind(item_hash)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Count watch history items for a device
pub async fn count_by_device(
    pool: &PgPool,
    device_id: &str,
) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM watch_history WHERE device_id = $1")
        .bind(device_id)
        .fetch_one(pool)
        .await?;

    Ok(row.0)
}

/// Cleanup old watch history entries, keeping only the most recent N entries per device
pub async fn cleanup_old_entries(
    pool: &PgPool,
    keep_count: i64,
) -> Result<i64, sqlx::Error> {
    // Use the database function for cleanup
    let row: (i32,) = sqlx::query_as("SELECT cleanup_watch_history($1)")
        .bind(keep_count as i32)
        .fetch_one(pool)
        .await?;

    Ok(row.0 as i64)
}
