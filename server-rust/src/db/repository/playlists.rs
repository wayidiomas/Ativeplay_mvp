//! Playlist repository for database operations

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::models::{NewPlaylist, PlaylistRow};
use crate::models::playlist::PlaylistStats;

/// Create or update a playlist
pub async fn upsert_playlist(
    pool: &PgPool,
    playlist: &NewPlaylist,
) -> Result<Uuid, sqlx::Error> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO playlists (client_id, hash, url, total_items, live_count, movie_count, series_count, unknown_count, group_count, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (client_id, hash) DO UPDATE SET
            url = EXCLUDED.url,
            total_items = EXCLUDED.total_items,
            live_count = EXCLUDED.live_count,
            movie_count = EXCLUDED.movie_count,
            series_count = EXCLUDED.series_count,
            unknown_count = EXCLUDED.unknown_count,
            group_count = EXCLUDED.group_count,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(playlist.client_id)
    .bind(&playlist.hash)
    .bind(&playlist.url)
    .bind(playlist.stats.total_items as i32)
    .bind(playlist.stats.live_count as i32)
    .bind(playlist.stats.movie_count as i32)
    .bind(playlist.stats.series_count as i32)
    .bind(playlist.stats.unknown_count as i32)
    .bind(playlist.stats.group_count as i32)
    .bind(playlist.expires_at)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

/// Find playlist by hash (optionally filtered by client)
pub async fn find_by_hash(
    pool: &PgPool,
    hash: &str,
    client_id: Option<Uuid>,
) -> Result<Option<PlaylistRow>, sqlx::Error> {
    let row = if let Some(cid) = client_id {
        sqlx::query_as::<_, PlaylistRow>(
            r#"
            SELECT id, client_id, hash, url, total_items, live_count, movie_count,
                   series_count, unknown_count, group_count, created_at, updated_at, expires_at
            FROM playlists
            WHERE hash = $1 AND client_id = $2
            "#,
        )
        .bind(hash)
        .bind(cid)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_as::<_, PlaylistRow>(
            r#"
            SELECT id, client_id, hash, url, total_items, live_count, movie_count,
                   series_count, unknown_count, group_count, created_at, updated_at, expires_at
            FROM playlists
            WHERE hash = $1 AND client_id IS NULL
            "#,
        )
        .bind(hash)
        .fetch_optional(pool)
        .await?
    };

    Ok(row)
}

/// Find playlist by hash (any client - for backward compatibility)
pub async fn find_by_hash_any(
    pool: &PgPool,
    hash: &str,
) -> Result<Option<PlaylistRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, PlaylistRow>(
        r#"
        SELECT id, client_id, hash, url, total_items, live_count, movie_count,
               series_count, unknown_count, group_count, created_at, updated_at, expires_at
        FROM playlists
        WHERE hash = $1
        ORDER BY updated_at DESC
        LIMIT 1
        "#,
    )
    .bind(hash)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Delete playlist and all related data (CASCADE)
pub async fn delete_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM playlists WHERE id = $1")
        .bind(playlist_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Update playlist stats
pub async fn update_stats(
    pool: &PgPool,
    playlist_id: Uuid,
    stats: &PlaylistStats,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE playlists SET
            total_items = $2,
            live_count = $3,
            movie_count = $4,
            series_count = $5,
            unknown_count = $6,
            group_count = $7,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(playlist_id)
    .bind(stats.total_items as i32)
    .bind(stats.live_count as i32)
    .bind(stats.movie_count as i32)
    .bind(stats.series_count as i32)
    .bind(stats.unknown_count as i32)
    .bind(stats.group_count as i32)
    .execute(pool)
    .await?;

    Ok(())
}

/// Check if playlist exists and return its ID
pub async fn exists(
    pool: &PgPool,
    hash: &str,
    client_id: Option<Uuid>,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row: Option<(Uuid,)> = if let Some(cid) = client_id {
        sqlx::query_as("SELECT id FROM playlists WHERE hash = $1 AND client_id = $2")
            .bind(hash)
            .bind(cid)
            .fetch_optional(pool)
            .await?
    } else {
        sqlx::query_as("SELECT id FROM playlists WHERE hash = $1 AND client_id IS NULL")
            .bind(hash)
            .fetch_optional(pool)
            .await?
    };

    Ok(row.map(|r| r.0))
}

/// List all playlists for a client
pub async fn list_by_client(
    pool: &PgPool,
    client_id: Uuid,
) -> Result<Vec<PlaylistRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, PlaylistRow>(
        r#"
        SELECT id, client_id, hash, url, total_items, live_count, movie_count,
               series_count, unknown_count, group_count, created_at, updated_at, expires_at
        FROM playlists
        WHERE client_id = $1
        ORDER BY updated_at DESC
        "#,
    )
    .bind(client_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Delete playlist by device_id (before creating a new one for the same device)
pub async fn delete_by_device(
    pool: &PgPool,
    device_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM playlists WHERE device_id = $1")
        .bind(device_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Update device_id and expires_at for an existing playlist
/// Used when reusing a cached playlist for a different device
pub async fn update_device_and_ttl(
    pool: &PgPool,
    playlist_id: Uuid,
    device_id: &str,
    expires_at: chrono::DateTime<chrono::Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE playlists SET
            device_id = $2,
            expires_at = $3,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(playlist_id)
    .bind(device_id)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Find playlist by device_id
pub async fn find_by_device(
    pool: &PgPool,
    device_id: &str,
) -> Result<Option<PlaylistRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, PlaylistRow>(
        r#"
        SELECT id, client_id, hash, url, total_items, live_count, movie_count,
               series_count, unknown_count, group_count, created_at, updated_at, expires_at
        FROM playlists
        WHERE device_id = $1
        "#,
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}
