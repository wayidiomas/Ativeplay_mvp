//! Playlist groups repository

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::models::{GroupRow, NewGroup};
use crate::models::playlist::PlaylistGroup;

/// Insert or update a group
pub async fn upsert_group(
    pool: &PgPool,
    group: &NewGroup,
) -> Result<Uuid, sqlx::Error> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO playlist_groups (playlist_id, group_hash, name, media_kind, item_count, logo)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (playlist_id, group_hash) DO UPDATE SET
            name = EXCLUDED.name,
            media_kind = EXCLUDED.media_kind,
            item_count = EXCLUDED.item_count,
            logo = EXCLUDED.logo
        RETURNING id
        "#,
    )
    .bind(group.playlist_id)
    .bind(&group.group_hash)
    .bind(&group.name)
    .bind(&group.media_kind)
    .bind(group.item_count)
    .bind(&group.logo)
    .fetch_one(pool)
    .await?;

    Ok(row.0)
}

/// Bulk insert groups
pub async fn insert_many(
    pool: &PgPool,
    groups: &[NewGroup],
) -> Result<usize, sqlx::Error> {
    if groups.is_empty() {
        return Ok(0);
    }

    let mut count = 0;
    for group in groups {
        upsert_group(pool, group).await?;
        count += 1;
    }

    Ok(count)
}

/// Get all groups for a playlist
pub async fn get_by_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<Vec<GroupRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, GroupRow>(
        r#"
        SELECT id, playlist_id, group_hash, name, media_kind, item_count, logo
        FROM playlist_groups
        WHERE playlist_id = $1
        ORDER BY name
        "#,
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get groups filtered by media kind
pub async fn get_by_kind(
    pool: &PgPool,
    playlist_id: Uuid,
    media_kind: &str,
) -> Result<Vec<GroupRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, GroupRow>(
        r#"
        SELECT id, playlist_id, group_hash, name, media_kind, item_count, logo
        FROM playlist_groups
        WHERE playlist_id = $1 AND media_kind = $2
        ORDER BY name
        "#,
    )
    .bind(playlist_id)
    .bind(media_kind)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Delete all groups for a playlist
pub async fn delete_by_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM playlist_groups WHERE playlist_id = $1")
        .bind(playlist_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Count groups for a playlist
pub async fn count_by_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<i64, sqlx::Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlist_groups WHERE playlist_id = $1")
        .bind(playlist_id)
        .fetch_one(pool)
        .await?;

    Ok(count.0)
}

/// Convert PlaylistGroup to NewGroup for insertion
pub fn from_playlist_group(group: &PlaylistGroup, playlist_id: Uuid) -> NewGroup {
    NewGroup {
        playlist_id,
        group_hash: group.id.clone(),
        name: group.name.clone(),
        media_kind: group.media_kind.to_string(),
        item_count: group.item_count as i32,
        logo: group.logo.clone(),
    }
}
