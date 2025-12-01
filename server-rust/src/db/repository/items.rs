//! Playlist items repository with streaming writes

use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::db::models::{format_copy_line, ItemRow, NewItem};
use crate::models::playlist::PlaylistItem;

/// Streaming database writer for bulk item inserts
/// Uses PostgreSQL COPY protocol for 50x faster inserts
pub struct StreamingDbWriter<'a> {
    tx: Transaction<'a, Postgres>,
    playlist_id: Uuid,
    batch: Vec<NewItem>,
    batch_size: usize,
    items_written: usize,
}

impl<'a> StreamingDbWriter<'a> {
    /// Create a new streaming writer
    pub async fn new(pool: &PgPool, playlist_id: Uuid) -> Result<StreamingDbWriter<'static>, sqlx::Error> {
        let tx = pool.begin().await?;

        Ok(StreamingDbWriter {
            tx,
            playlist_id,
            batch: Vec::with_capacity(500),
            batch_size: 500,
            items_written: 0,
        })
    }

    /// Write a single item (batched)
    pub async fn write_item(&mut self, item: &PlaylistItem) -> Result<(), sqlx::Error> {
        let new_item = NewItem::from_item(item, self.playlist_id, self.items_written as i32);
        self.batch.push(new_item);
        self.items_written += 1;

        if self.batch.len() >= self.batch_size {
            self.flush_batch().await?;
        }

        Ok(())
    }

    /// Flush the current batch to database
    async fn flush_batch(&mut self) -> Result<(), sqlx::Error> {
        if self.batch.is_empty() {
            return Ok(());
        }

        // Use raw COPY for maximum performance
        let copy_query = r#"
            COPY playlist_items (id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
                                 parsed_title, parsed_year, parsed_quality, series_id,
                                 season_number, episode_number, sort_order)
            FROM STDIN WITH (FORMAT text, NULL '\N')
        "#;

        let mut copy = self.tx.copy_in_raw(copy_query).await?;

        for item in &self.batch {
            let line = format_copy_line(item);
            copy.send(line.as_bytes()).await?;
        }

        copy.finish().await?;
        self.batch.clear();

        Ok(())
    }

    /// Finish writing and commit the transaction
    pub async fn finish(mut self) -> Result<usize, sqlx::Error> {
        // Flush any remaining items
        self.flush_batch().await?;

        // Commit the transaction
        self.tx.commit().await?;

        Ok(self.items_written)
    }

    /// Get the number of items written so far
    pub fn items_written(&self) -> usize {
        self.items_written
    }
}

/// Delete all items for a playlist
pub async fn delete_by_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM playlist_items WHERE playlist_id = $1")
        .bind(playlist_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Get items with pagination and optional filters
pub async fn get_items(
    pool: &PgPool,
    playlist_id: Uuid,
    group: Option<&str>,
    media_kind: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<ItemRow>, sqlx::Error> {
    let rows = match (group, media_kind) {
        (Some(g), Some(k)) => {
            sqlx::query_as::<_, ItemRow>(
                r#"
                SELECT id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
                       parsed_title, parsed_year, parsed_quality, series_id,
                       season_number, episode_number, sort_order
                FROM playlist_items
                WHERE playlist_id = $1 AND group_name = $2 AND media_kind = $3
                ORDER BY sort_order
                LIMIT $4 OFFSET $5
                "#,
            )
            .bind(playlist_id)
            .bind(g)
            .bind(k)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        (Some(g), None) => {
            sqlx::query_as::<_, ItemRow>(
                r#"
                SELECT id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
                       parsed_title, parsed_year, parsed_quality, series_id,
                       season_number, episode_number, sort_order
                FROM playlist_items
                WHERE playlist_id = $1 AND group_name = $2
                ORDER BY sort_order
                LIMIT $3 OFFSET $4
                "#,
            )
            .bind(playlist_id)
            .bind(g)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        (None, Some(k)) => {
            sqlx::query_as::<_, ItemRow>(
                r#"
                SELECT id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
                       parsed_title, parsed_year, parsed_quality, series_id,
                       season_number, episode_number, sort_order
                FROM playlist_items
                WHERE playlist_id = $1 AND media_kind = $2
                ORDER BY sort_order
                LIMIT $3 OFFSET $4
                "#,
            )
            .bind(playlist_id)
            .bind(k)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as::<_, ItemRow>(
                r#"
                SELECT id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
                       parsed_title, parsed_year, parsed_quality, series_id,
                       season_number, episode_number, sort_order
                FROM playlist_items
                WHERE playlist_id = $1
                ORDER BY sort_order
                LIMIT $2 OFFSET $3
                "#,
            )
            .bind(playlist_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
    };

    Ok(rows)
}

/// Count items with optional filters
pub async fn count_items(
    pool: &PgPool,
    playlist_id: Uuid,
    group: Option<&str>,
    media_kind: Option<&str>,
) -> Result<i64, sqlx::Error> {
    let count: (i64,) = match (group, media_kind) {
        (Some(g), Some(k)) => {
            sqlx::query_as(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = $1 AND group_name = $2 AND media_kind = $3",
            )
            .bind(playlist_id)
            .bind(g)
            .bind(k)
            .fetch_one(pool)
            .await?
        }
        (Some(g), None) => {
            sqlx::query_as(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = $1 AND group_name = $2",
            )
            .bind(playlist_id)
            .bind(g)
            .fetch_one(pool)
            .await?
        }
        (None, Some(k)) => {
            sqlx::query_as(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = $1 AND media_kind = $2",
            )
            .bind(playlist_id)
            .bind(k)
            .fetch_one(pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = $1",
            )
            .bind(playlist_id)
            .fetch_one(pool)
            .await?
        }
    };

    Ok(count.0)
}

/// Search items using fuzzy matching (pg_trgm)
pub async fn search_items(
    pool: &PgPool,
    playlist_id: Uuid,
    query: &str,
    limit: i64,
) -> Result<Vec<ItemRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ItemRow>(
        r#"
        SELECT id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
               parsed_title, parsed_year, parsed_quality, series_id,
               season_number, episode_number, sort_order
        FROM playlist_items
        WHERE playlist_id = $1
          AND (name % $2 OR name ILIKE '%' || $2 || '%')
        ORDER BY similarity(name, $2) DESC
        LIMIT $3
        "#,
    )
    .bind(playlist_id)
    .bind(query)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get a single item by hash
pub async fn get_by_hash(
    pool: &PgPool,
    playlist_id: Uuid,
    item_hash: &str,
) -> Result<Option<ItemRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, ItemRow>(
        r#"
        SELECT id, playlist_id, item_hash, name, url, logo, group_name, media_kind,
               parsed_title, parsed_year, parsed_quality, series_id,
               season_number, episode_number, sort_order
        FROM playlist_items
        WHERE playlist_id = $1 AND item_hash = $2
        "#,
    )
    .bind(playlist_id)
    .bind(item_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Count all items for a playlist
pub async fn count_by_playlist(
    pool: &PgPool,
    playlist_id: Uuid,
) -> Result<i64, sqlx::Error> {
    count_items(pool, playlist_id, None, None).await
}
