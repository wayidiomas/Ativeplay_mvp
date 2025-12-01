use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{self, File};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::RwLock;

use crate::models::{CacheMetadata, PlaylistItem};

/// Streaming writer for incrementally writing items to disk
/// Prevents OOM by not accumulating all items in memory
pub struct StreamingItemWriter {
    writer: BufWriter<File>,
    tmp_path: PathBuf,
    final_path: PathBuf,
    items_written: usize,
    /// Buffer for batched writes (reduces syscalls)
    batch_buffer: Vec<u8>,
    batch_size: usize,
}

impl StreamingItemWriter {
    /// Create a new streaming writer
    pub async fn new(tmp_path: PathBuf, final_path: PathBuf, batch_size: usize) -> Result<Self> {
        let file = File::create(&tmp_path).await?;
        let writer = BufWriter::with_capacity(64 * 1024, file); // 64KB buffer

        Ok(Self {
            writer,
            tmp_path,
            final_path,
            items_written: 0,
            batch_buffer: Vec::with_capacity(batch_size * 512), // Estimate ~512 bytes per item
            batch_size,
        })
    }

    /// Write a single item (batched internally)
    pub async fn write_item(&mut self, item: &PlaylistItem) -> Result<()> {
        let line = serde_json::to_vec(item)?;
        self.batch_buffer.extend_from_slice(&line);
        self.batch_buffer.push(b'\n');
        self.items_written += 1;

        // Flush batch when full
        if self.items_written % self.batch_size == 0 {
            self.flush_batch().await?;
        }

        Ok(())
    }

    /// Flush pending batch to disk
    async fn flush_batch(&mut self) -> Result<()> {
        if !self.batch_buffer.is_empty() {
            self.writer.write_all(&self.batch_buffer).await?;
            self.batch_buffer.clear();
        }
        Ok(())
    }

    /// Finalize: flush remaining data, sync, and atomic rename
    pub async fn finalize(mut self) -> Result<usize> {
        // Flush any remaining data
        self.flush_batch().await?;
        self.writer.flush().await?;
        self.writer.get_ref().sync_all().await?;

        // Drop the writer to release the file handle
        drop(self.writer);

        // Atomic rename
        let _ = fs::remove_file(&self.final_path).await;
        fs::rename(&self.tmp_path, &self.final_path).await?;

        Ok(self.items_written)
    }

    /// Abort: remove temp file without renaming
    pub async fn abort(self) -> Result<()> {
        drop(self.writer);
        let _ = fs::remove_file(&self.tmp_path).await;
        Ok(())
    }

    /// Get count of items written so far
    pub fn items_written(&self) -> usize {
        self.items_written
    }
}

/// Disk-based cache service for playlist data
/// Uses .ndjson for items (newline-delimited JSON) and .meta.json for metadata
pub struct CacheService {
    cache_dir: PathBuf,
    /// In-memory index of cache metadata (loaded on startup)
    index: Arc<RwLock<HashMap<String, CacheMetadata>>>,
    /// Optional cap on number of cached playlists (oldest evicted)
    max_entries: Option<usize>,
    /// Optional cap on total cache size in bytes (oldest evicted)
    max_bytes: Option<u64>,
}

impl CacheService {
    /// Create a new cache service and load existing metadata
    pub async fn new(cache_dir: &str, max_entries: Option<usize>, max_bytes: Option<u64>) -> Result<Self> {
        let cache_dir = PathBuf::from(cache_dir);

        // Create cache directory if not exists
        fs::create_dir_all(&cache_dir).await?;

        let service = Self {
            cache_dir,
            index: Arc::new(RwLock::new(HashMap::new())),
            max_entries,
            max_bytes,
        };

        // Load existing cache metadata
        service.load_index().await?;

        // Apply initial GC so we start within bounds
        service.enforce_limits().await?;

        Ok(service)
    }

    /// Load all .meta.json files into memory index
    async fn load_index(&self) -> Result<()> {
        let mut entries = fs::read_dir(&self.cache_dir).await?;
        let mut index = self.index.write().await;
        let now = chrono::Utc::now().timestamp_millis();
        let mut expired_hashes: Vec<String> = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Some(filename) = path.file_stem() {
                    if filename.to_string_lossy().ends_with(".meta") {
                        // Read and parse metadata
                        match fs::read_to_string(&path).await {
                            Ok(content) => {
                                match serde_json::from_str::<CacheMetadata>(&content) {
                                    Ok(meta) => {
                                        // Skip expired entries
                                        if meta.expires_at > now {
                                            index.insert(meta.hash.clone(), meta);
                                        } else {
                                            expired_hashes.push(meta.hash.clone());
                                        }
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            "Failed to parse cache metadata {}: {}",
                                            path.display(),
                                            e
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Failed to read cache file {}: {}",
                                    path.display(),
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }

        tracing::info!("Loaded {} cached playlists", index.len());
        drop(index);

        // Clean up expired files after releasing the index lock to avoid deadlocks
        for hash in expired_hashes {
            let _ = self.delete_cache_files(&hash).await;
        }
        Ok(())
    }

    /// Get cache metadata by hash
    pub async fn get_metadata(&self, hash: &str) -> Option<CacheMetadata> {
        let index = self.index.read().await;
        let meta = index.get(hash)?;

        // Check if expired
        let now = chrono::Utc::now().timestamp_millis();
        if meta.expires_at <= now {
            return None;
        }

        Some(meta.clone())
    }

    /// Check if cache exists and is valid
    pub async fn has_cache(&self, hash: &str) -> bool {
        self.get_metadata(hash).await.is_some()
    }

    /// Create a streaming writer for incremental item writes
    /// Use this instead of save_items() for large playlists to avoid OOM
    pub async fn create_streaming_writer(&self, hash: &str, batch_size: usize) -> Result<StreamingItemWriter> {
        let tmp_path = self.items_tmp_path(hash);
        let final_path = self.items_path(hash);
        StreamingItemWriter::new(tmp_path, final_path, batch_size).await
    }

    /// Save playlist items to .ndjson file (loads all into memory - use streaming for large playlists)
    pub async fn save_items(&self, hash: &str, items: &[PlaylistItem]) -> Result<()> {
        let path = self.items_path(hash);
        let tmp_path = self.items_tmp_path(hash);
        let file = File::create(&tmp_path).await?;
        let mut writer = BufWriter::new(file);

        for item in items {
            let line = serde_json::to_string(item)?;
            writer.write_all(line.as_bytes()).await?;
            writer.write_all(b"\n").await?;
        }

        writer.flush().await?;
        writer.get_ref().sync_all().await?;
        drop(writer);

        // Atomic replace to avoid readers seeing partial writes
        let _ = fs::remove_file(&path).await;
        fs::rename(&tmp_path, &path).await?;
        Ok(())
    }

    /// Save cache metadata to .meta.json file
    pub async fn save_metadata(&self, hash: &str, metadata: &CacheMetadata) -> Result<()> {
        let path = self.meta_path(hash);
        let tmp_path = self.meta_tmp_path(hash);
        let content = serde_json::to_string_pretty(metadata)?;

        let mut file = File::create(&tmp_path).await?;
        file.write_all(content.as_bytes()).await?;
        file.sync_all().await?;

        // Atomic replace to avoid readers seeing partial writes
        let _ = fs::remove_file(&path).await;
        fs::rename(&tmp_path, &path).await?;

        // Update in-memory index
        let mut index = self.index.write().await;
        index.insert(hash.to_string(), metadata.clone());
        drop(index);

        // Enforce TTL/LRU caps if configured
        self.enforce_limits().await?;

        Ok(())
    }

    /// Read items from .ndjson file with pagination
    pub async fn read_items(
        &self,
        hash: &str,
        offset: usize,
        limit: usize,
        group_filter: Option<&str>,
        media_kind_filter: Option<&str>,
    ) -> Result<(Vec<PlaylistItem>, usize)> {
        let path = self.items_path(hash);
        let file = File::open(&path)
            .await
            .context("Cache file not found")?;

        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        let mut items = Vec::with_capacity(limit);
        let mut total_matching = 0;
        let mut current_offset = 0;

        while let Some(line) = lines.next_line().await? {
            if line.is_empty() {
                continue;
            }

            let item: PlaylistItem = serde_json::from_str(&line)?;

            // Apply filters
            let matches_group = group_filter
                .map(|g| item.group.eq_ignore_ascii_case(g))
                .unwrap_or(true);

            let matches_kind = media_kind_filter
                .map(|k| item.media_kind.to_string().eq_ignore_ascii_case(k))
                .unwrap_or(true);

            if matches_group && matches_kind {
                total_matching += 1;

                if current_offset >= offset && items.len() < limit {
                    items.push(item);
                }
                current_offset += 1;
            }
        }

        Ok((items, total_matching))
    }

    /// Read all items from .ndjson file (for reprocessing)
    pub async fn read_all_items(&self, hash: &str) -> Result<Vec<PlaylistItem>> {
        let path = self.items_path(hash);
        let file = File::open(&path)
            .await
            .context("Cache file not found")?;

        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        let mut items = Vec::new();

        while let Some(line) = lines.next_line().await? {
            if line.is_empty() {
                continue;
            }
            let item: PlaylistItem = serde_json::from_str(&line)?;
            items.push(item);
        }

        Ok(items)
    }

    /// Delete cache files for a hash
    pub async fn delete_cache_files(&self, hash: &str) -> Result<()> {
        let items_path = self.items_path(hash);
        let meta_path = self.meta_path(hash);

        let _ = fs::remove_file(&items_path).await;
        let _ = fs::remove_file(&meta_path).await;

        // Remove from index
        let mut index = self.index.write().await;
        index.remove(hash);

        Ok(())
    }

    /// Clean up expired cache entries
    pub async fn cleanup_expired(&self) -> Result<usize> {
        let now = chrono::Utc::now().timestamp_millis();
        let index = self.index.read().await;
        let expired: Vec<String> = index
            .iter()
            .filter(|(_, meta)| meta.expires_at <= now)
            .map(|(hash, _)| hash.clone())
            .collect();
        drop(index);

        let count = expired.len();
        for hash in expired {
            let _ = self.delete_cache_files(&hash).await;
        }

        Ok(count)
    }

    /// Evict oldest caches when exceeding max_entries
    pub async fn cleanup_over_limit(&self, max_entries: usize) -> Result<usize> {
        let index = self.index.read().await;
        let total = index.len();
        if total <= max_entries {
            return Ok(0);
        }

        let mut metas: Vec<CacheMetadata> = index.values().cloned().collect();
        drop(index);

        metas.sort_by_key(|m| m.created_at);
        let excess = total - max_entries;
        let mut removed = 0usize;

        for meta in metas.into_iter().take(excess) {
            self.delete_cache_files(&meta.hash).await?;
            removed += 1;
        }

        Ok(removed)
    }

    /// Evict oldest caches until total size <= max_bytes
    pub async fn cleanup_over_size(&self, max_bytes: u64) -> Result<usize> {
        let mut metas = {
            let index = self.index.read().await;
            index.values().cloned().collect::<Vec<_>>()
        };

        metas.sort_by_key(|m| m.created_at);

        let mut removed = 0usize;
        let mut total_size = self.get_cache_size().await.unwrap_or(0);

        for meta in metas {
            if total_size <= max_bytes {
                break;
            }

            self.delete_cache_files(&meta.hash).await?;
            removed += 1;
            total_size = self.get_cache_size().await.unwrap_or(0);
        }

        Ok(removed)
    }

    async fn enforce_limits(&self) -> Result<()> {
        // Always drop expired first
        let expired = self.cleanup_expired().await?;
        if expired > 0 {
            tracing::info!(cache_gc_expired = expired, msg = "expired cache entries removed");
        }

        if let Some(max_entries) = self.max_entries {
            let removed = self.cleanup_over_limit(max_entries).await?;
            if removed > 0 {
                tracing::info!(cache_gc_evicted = removed, max_entries = max_entries, msg = "cache entries evicted by LRU");
            }
        }

        if let Some(max_bytes) = self.max_bytes {
            let removed = self.cleanup_over_size(max_bytes).await?;
            if removed > 0 {
                tracing::info!(cache_gc_evicted = removed, max_bytes = max_bytes, msg = "cache entries evicted by size");
            }
        }

        Ok(())
    }

    /// Get cache directory size in bytes
    pub async fn get_cache_size(&self) -> Result<u64> {
        let mut total_size = 0u64;
        let mut entries = fs::read_dir(&self.cache_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            if let Ok(metadata) = entry.metadata().await {
                total_size += metadata.len();
            }
        }

        Ok(total_size)
    }

    /// Get number of cached playlists
    pub async fn get_cache_count(&self) -> usize {
        let index = self.index.read().await;
        index.len()
    }

    /// Clear all cache
    pub async fn clear_all(&self) -> Result<usize> {
        let index = self.index.read().await;
        let hashes: Vec<String> = index.keys().cloned().collect();
        drop(index);

        let count = hashes.len();
        for hash in hashes {
            let _ = self.delete_cache_files(&hash).await;
        }

        Ok(count)
    }

    // ============ Path Helpers ============

    fn items_path(&self, hash: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.ndjson", hash))
    }

    fn items_tmp_path(&self, hash: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.ndjson.tmp", hash))
    }

    fn meta_path(&self, hash: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.meta.json", hash))
    }

    fn meta_tmp_path(&self, hash: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.meta.json.tmp", hash))
    }
}

impl Clone for CacheService {
    fn clone(&self) -> Self {
        Self {
            cache_dir: self.cache_dir.clone(),
            index: Arc::clone(&self.index),
            max_entries: self.max_entries,
            max_bytes: self.max_bytes,
        }
    }
}
