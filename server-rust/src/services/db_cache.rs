//! PostgreSQL-based cache service for playlist data
//!
//! Replaces the disk-based CacheService with PostgreSQL storage.
//! Uses the same interface for compatibility.

use anyhow::{Context, Result};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::models::{NewGroup, NewPlaylist, NewSeries, NewEpisode};
use crate::db::repository::{groups, items, playlists, series, StreamingDbWriter};
use crate::models::playlist::{
    CacheMetadata, PlaylistGroup, PlaylistItem, PlaylistStats, SeriesInfo,
};

/// PostgreSQL-based cache service for playlist data
#[derive(Clone)]
pub struct DbCacheService {
    pool: PgPool,
}

impl DbCacheService {
    /// Create a new database cache service
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get cache metadata by hash
    pub async fn get_metadata(&self, hash: &str) -> Result<Option<CacheMetadata>> {
        let playlist = match playlists::find_by_hash_any(&self.pool, hash).await? {
            Some(p) => p,
            None => return Ok(None),
        };

        // Get groups
        let group_rows = groups::get_by_playlist(&self.pool, playlist.id).await?;
        let groups: Vec<PlaylistGroup> = group_rows.into_iter().map(Into::into).collect();

        // Get series
        let series_rows = series::get_by_playlist(&self.pool, playlist.id).await?;
        let series_list: Vec<SeriesInfo> = series_rows.into_iter().map(Into::into).collect();

        // Get stats before moving other fields
        let stats = playlist.to_stats();
        let created_at = playlist.created_at.timestamp_millis();

        // Extract Xtream metadata if present
        let source_type = playlist.source_type.as_ref().map(|s| s.to_string());
        let playlist_id = Some(playlist.id.to_string());

        Ok(Some(CacheMetadata {
            hash: playlist.hash,
            url: playlist.url,
            stats,
            groups,
            series: series_list,
            created_at,
            expires_at: i64::MAX, // Eternal TTL as per user decision
            source_type,
            playlist_id,
        }))
    }

    /// Check if cache exists (does NOT check TTL)
    pub async fn has_cache(&self, hash: &str) -> bool {
        playlists::find_by_hash_any(&self.pool, hash)
            .await
            .map(|p| p.is_some())
            .unwrap_or(false)
    }

    /// Check if cache exists AND is not expired (respects TTL)
    /// Returns false if playlist doesn't exist OR if expires_at < NOW()
    pub async fn is_cache_valid(&self, hash: &str) -> bool {
        match playlists::find_by_hash_any(&self.pool, hash).await {
            Ok(Some(playlist)) => {
                // Check if expired
                if let Some(expires_at) = playlist.expires_at {
                    let now = chrono::Utc::now();
                    if expires_at < now {
                        tracing::debug!("Cache {} expired at {}", hash, expires_at);
                        return false;
                    }
                }
                // Has items and not expired
                playlist.total_items > 0
            }
            _ => false,
        }
    }

    /// Get playlist ID by hash (internal helper)
    pub async fn get_playlist_id(&self, hash: &str) -> Result<Option<Uuid>> {
        let playlist = playlists::find_by_hash_any(&self.pool, hash).await?;
        Ok(playlist.map(|p| p.id))
    }

    /// Create a streaming writer for incremental item writes
    pub async fn create_streaming_writer(&self, playlist_id: Uuid) -> Result<StreamingDbWriter<'static>> {
        let writer = StreamingDbWriter::new(&self.pool, playlist_id).await?;
        Ok(writer)
    }

    /// Save playlist metadata and return the playlist ID
    pub async fn save_playlist(
        &self,
        hash: &str,
        url: &str,
        stats: &PlaylistStats,
        client_id: Option<Uuid>,
    ) -> Result<Uuid> {
        self.save_playlist_with_ttl(hash, url, stats, client_id, None, None).await
    }

    /// Save playlist metadata with optional TTL and device_id, and return the playlist ID
    /// This sets all fields atomically to prevent orphan playlists
    pub async fn save_playlist_with_ttl(
        &self,
        hash: &str,
        url: &str,
        stats: &PlaylistStats,
        client_id: Option<Uuid>,
        ttl_seconds: Option<i64>,
        device_id: Option<&str>,
    ) -> Result<Uuid> {
        use chrono::{Duration, Utc};

        let expires_at = ttl_seconds.map(|secs| Utc::now() + Duration::seconds(secs));

        let new_playlist = NewPlaylist {
            client_id,
            device_id: device_id.map(|s| s.to_string()),
            hash: hash.to_string(),
            url: url.to_string(),
            stats: stats.clone(),
            expires_at,
        };

        let playlist_id = playlists::upsert_playlist(&self.pool, &new_playlist).await?;
        Ok(playlist_id)
    }

    /// Save groups for a playlist
    pub async fn save_groups(
        &self,
        playlist_id: Uuid,
        playlist_groups: &[PlaylistGroup],
    ) -> Result<usize> {
        // Delete existing groups first
        groups::delete_by_playlist(&self.pool, playlist_id).await?;

        // Insert new groups
        let new_groups: Vec<NewGroup> = playlist_groups
            .iter()
            .map(|g| groups::from_playlist_group(g, playlist_id))
            .collect();

        let count = groups::insert_many(&self.pool, &new_groups).await?;
        Ok(count)
    }

    /// Save series for a playlist
    pub async fn save_series(
        &self,
        playlist_id: Uuid,
        series_list: &[SeriesInfo],
    ) -> Result<usize> {
        // Delete existing series first (cascade deletes episodes)
        series::delete_by_playlist(&self.pool, playlist_id).await?;

        // Insert new series
        let new_series: Vec<NewSeries> = series_list
            .iter()
            .map(|s| series::from_series_info(s, playlist_id))
            .collect();

        let ids = series::insert_many(&self.pool, &new_series).await?;

        // Insert episodes for each series
        for (series_info, series_db_id) in series_list.iter().zip(ids.iter()) {
            if let Some(seasons_data) = &series_info.seasons_data {
                let mut episodes = Vec::new();
                for season in seasons_data {
                    for ep in &season.episodes {
                        episodes.push(NewEpisode {
                            series_id: *series_db_id,
                            item_id: None, // We don't have the item UUID here
                            item_hash: ep.item_id.clone(),
                            season: season.season_number as i16,
                            episode: ep.episode as i16,
                            name: ep.name.clone(),
                            url: ep.url.clone(),
                        });
                    }
                }
                series::insert_many_episodes(&self.pool, &episodes).await?;
            }
        }

        Ok(series_list.len())
    }

    /// Save complete metadata (playlist + groups + series)
    pub async fn save_metadata(
        &self,
        hash: &str,
        metadata: &CacheMetadata,
    ) -> Result<Uuid> {
        // Save playlist
        let playlist_id = self.save_playlist(
            hash,
            &metadata.url,
            &metadata.stats,
            None,
        ).await?;

        // Save groups
        self.save_groups(playlist_id, &metadata.groups).await?;

        // Save series
        self.save_series(playlist_id, &metadata.series).await?;

        Ok(playlist_id)
    }

    /// Read items with pagination and optional filters
    pub async fn read_items(
        &self,
        hash: &str,
        offset: usize,
        limit: usize,
        group_filter: Option<&str>,
        media_kind_filter: Option<&str>,
    ) -> Result<(Vec<PlaylistItem>, usize)> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let item_rows = items::get_items(
            &self.pool,
            playlist_id,
            group_filter,
            media_kind_filter,
            limit as i64,
            offset as i64,
        ).await?;

        let total = items::count_items(
            &self.pool,
            playlist_id,
            group_filter,
            media_kind_filter,
        ).await? as usize;

        let playlist_items: Vec<PlaylistItem> = item_rows.into_iter().map(Into::into).collect();

        Ok((playlist_items, total))
    }

    /// Search items using fuzzy matching
    pub async fn search_items(
        &self,
        hash: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<PlaylistItem>> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let item_rows = items::search_items(&self.pool, playlist_id, query, limit as i64).await?;
        let playlist_items: Vec<PlaylistItem> = item_rows.into_iter().map(Into::into).collect();

        Ok(playlist_items)
    }

    /// Get groups for a playlist
    pub async fn get_groups(&self, hash: &str) -> Result<Vec<PlaylistGroup>> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let group_rows = groups::get_by_playlist(&self.pool, playlist_id).await?;
        let playlist_groups: Vec<PlaylistGroup> = group_rows.into_iter().map(Into::into).collect();

        Ok(playlist_groups)
    }

    /// Get groups filtered by media kind
    pub async fn get_groups_by_kind(
        &self,
        hash: &str,
        media_kind: &str,
    ) -> Result<Vec<PlaylistGroup>> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let group_rows = groups::get_by_kind(&self.pool, playlist_id, media_kind).await?;
        let playlist_groups: Vec<PlaylistGroup> = group_rows.into_iter().map(Into::into).collect();

        Ok(playlist_groups)
    }

    /// Get series for a playlist
    pub async fn get_series(&self, hash: &str) -> Result<Vec<SeriesInfo>> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let series_rows = series::get_by_playlist(&self.pool, playlist_id).await?;
        let series_list: Vec<SeriesInfo> = series_rows.into_iter().map(Into::into).collect();

        Ok(series_list)
    }

    /// Get series filtered by group
    pub async fn get_series_by_group(
        &self,
        hash: &str,
        group_name: &str,
    ) -> Result<Vec<SeriesInfo>> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let series_rows = series::get_by_group(&self.pool, playlist_id, group_name).await?;
        let series_list: Vec<SeriesInfo> = series_rows.into_iter().map(Into::into).collect();

        Ok(series_list)
    }

    /// Get a series with all its episodes
    pub async fn get_series_detail(
        &self,
        hash: &str,
        series_hash: &str,
    ) -> Result<Option<SeriesInfo>> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        let series_info = series::get_series_with_episodes(&self.pool, playlist_id, series_hash).await?;
        Ok(series_info)
    }

    /// Delete a playlist and all related data
    pub async fn delete_playlist(&self, hash: &str) -> Result<bool> {
        let playlist_id = match self.get_playlist_id(hash).await? {
            Some(id) => id,
            None => return Ok(false),
        };

        let deleted = playlists::delete_playlist(&self.pool, playlist_id).await?;
        Ok(deleted > 0)
    }

    /// Update playlist stats
    pub async fn update_stats(&self, hash: &str, stats: &PlaylistStats) -> Result<()> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        playlists::update_stats(&self.pool, playlist_id, stats).await?;
        Ok(())
    }

    /// Get stats for a playlist
    pub async fn get_stats(&self, hash: &str) -> Result<Option<PlaylistStats>> {
        let playlist = match playlists::find_by_hash_any(&self.pool, hash).await? {
            Some(p) => p,
            None => return Ok(None),
        };

        Ok(Some(playlist.to_stats()))
    }

    /// Clear all items for a playlist (before re-parsing)
    pub async fn clear_items(&self, hash: &str) -> Result<()> {
        let playlist_id = self.get_playlist_id(hash)
            .await?
            .context("Playlist not found")?;

        items::delete_by_playlist(&self.pool, playlist_id).await?;
        Ok(())
    }

    /// Get URL for a playlist hash
    pub async fn get_url(&self, hash: &str) -> Result<Option<String>> {
        let playlist = playlists::find_by_hash_any(&self.pool, hash).await?;
        Ok(playlist.map(|p| p.url))
    }

    /// List all playlists for a client
    pub async fn list_playlists(&self, client_id: Uuid) -> Result<Vec<CacheMetadata>> {
        let playlist_rows = playlists::list_by_client(&self.pool, client_id).await?;
        let mut result = Vec::with_capacity(playlist_rows.len());

        for playlist in playlist_rows {
            let group_rows = groups::get_by_playlist(&self.pool, playlist.id).await?;
            let groups: Vec<PlaylistGroup> = group_rows.into_iter().map(Into::into).collect();

            let series_rows = series::get_by_playlist(&self.pool, playlist.id).await?;
            let series_list: Vec<SeriesInfo> = series_rows.into_iter().map(Into::into).collect();

            // Get stats before moving other fields
            let stats = playlist.to_stats();
            let created_at = playlist.created_at.timestamp_millis();

            // Extract Xtream metadata if present
            let source_type = playlist.source_type.as_ref().map(|s| s.to_string());
            let playlist_id = Some(playlist.id.to_string());

            result.push(CacheMetadata {
                hash: playlist.hash,
                url: playlist.url,
                stats,
                groups,
                series: series_list,
                created_at,
                expires_at: i64::MAX,
                source_type,
                playlist_id,
            });
        }

        Ok(result)
    }
}
