use anyhow::Result;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// Parse progress for real-time status tracking
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParseProgress {
    pub status: String,           // "parsing" | "building_groups" | "complete" | "failed"
    pub items_parsed: u64,
    pub items_total: Option<u64>, // Estimated based on content-length
    pub groups_count: u64,
    pub series_count: u64,
    pub current_phase: String,    // "downloading" | "parsing" | "groups" | "series" | "done"
    pub error: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
}

impl ParseProgress {
    pub fn new_parsing() -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            status: "parsing".to_string(),
            items_parsed: 0,
            items_total: None,
            groups_count: 0,
            series_count: 0,
            current_phase: "downloading".to_string(),
            error: None,
            started_at: now,
            updated_at: now,
        }
    }

    pub fn update(&mut self, items: u64, phase: &str) {
        self.items_parsed = items;
        self.current_phase = phase.to_string();
        self.updated_at = chrono::Utc::now().timestamp_millis();
    }

    pub fn complete(mut self, groups: u64, series: u64) -> Self {
        self.status = "complete".to_string();
        self.current_phase = "done".to_string();
        self.groups_count = groups;
        self.series_count = series;
        self.updated_at = chrono::Utc::now().timestamp_millis();
        self
    }

    pub fn failed(mut self, error: &str) -> Self {
        self.status = "failed".to_string();
        self.error = Some(error.to_string());
        self.updated_at = chrono::Utc::now().timestamp_millis();
        self
    }
}

/// Redis service for session management and caching
#[derive(Clone)]
pub struct RedisService {
    conn: ConnectionManager,
}

impl RedisService {
    /// Create a new Redis service with connection pooling
    pub async fn new(redis_url: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }

    /// Set a key with expiration (seconds)
    pub async fn set_ex<T: Serialize>(&self, key: &str, value: &T, ttl_seconds: u64) -> Result<()> {
        let mut conn = self.conn.clone();
        let serialized = serde_json::to_string(value)?;
        conn.set_ex(key, serialized, ttl_seconds).await?;
        Ok(())
    }

    /// Get a key and deserialize
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let mut conn = self.conn.clone();
        let value: Option<String> = conn.get(key).await?;
        match value {
            Some(v) => {
                let parsed = serde_json::from_str(&v)?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }

    /// Delete a key
    pub async fn del(&self, key: &str) -> Result<()> {
        let mut conn = self.conn.clone();
        conn.del(key).await?;
        Ok(())
    }

    /// Set a key only if it doesn't exist (for locking)
    /// Returns true if set successfully, false if key already exists
    pub async fn set_nx_ex(&self, key: &str, value: &str, ttl_seconds: u64) -> Result<bool> {
        let mut conn = self.conn.clone();
        let result: Option<String> = redis::cmd("SET")
            .arg(key)
            .arg(value)
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds)
            .query_async(&mut conn)
            .await?;
        Ok(result.is_some())
    }

    /// Check if a key exists
    pub async fn exists(&self, key: &str) -> Result<bool> {
        let mut conn = self.conn.clone();
        let exists: bool = conn.exists(key).await?;
        Ok(exists)
    }

    /// Flush all keys from the current database (use with caution!)
    pub async fn flush_db(&self) -> Result<()> {
        let mut conn = self.conn.clone();
        let _: () = redis::cmd("FLUSHDB")
            .query_async(&mut conn)
            .await?;
        Ok(())
    }

    /// Get TTL of a key in seconds (-2 if not exists, -1 if no TTL)
    pub async fn ttl(&self, key: &str) -> Result<i64> {
        let mut conn = self.conn.clone();
        let ttl: i64 = conn.ttl(key).await?;
        Ok(ttl)
    }

    /// Ping Redis to check connection
    pub async fn ping(&self) -> Result<bool> {
        let mut conn = self.conn.clone();
        let pong: String = redis::cmd("PING").query_async(&mut conn).await?;
        Ok(pong == "PONG")
    }

    /// Get Redis info (for health checks)
    pub async fn info(&self) -> Result<String> {
        let mut conn = self.conn.clone();
        let info: String = redis::cmd("INFO").query_async(&mut conn).await?;
        Ok(info)
    }

    // ============ Session Operations ============

    /// Create a new session
    pub async fn create_session(
        &self,
        session_id: &str,
        ttl_seconds: u64,
    ) -> Result<()> {
        use crate::models::Session;

        let session = Session {
            url: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        self.set_ex(&format!("session:{}", session_id), &session, ttl_seconds)
            .await
    }

    /// Get session data
    pub async fn get_session(&self, session_id: &str) -> Result<Option<crate::models::Session>> {
        self.get(&format!("session:{}", session_id)).await
    }

    /// Update session with URL
    pub async fn set_session_url(
        &self,
        session_id: &str,
        url: &str,
        ttl_seconds: u64,
    ) -> Result<bool> {
        use crate::models::Session;

        // Get existing session first
        if let Some(mut session) = self.get_session(session_id).await? {
            session.url = Some(url.to_string());
            self.set_ex(&format!("session:{}", session_id), &session, ttl_seconds)
                .await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // ============ Processing Lock Operations ============

    /// Acquire processing lock (prevents duplicate parsing)
    pub async fn acquire_processing_lock(
        &self,
        hash: &str,
        job_id: &str,
        ttl_seconds: u64,
    ) -> Result<bool> {
        self.set_nx_ex(&format!("processing:{}", hash), job_id, ttl_seconds)
            .await
    }

    /// Get processing lock value (job_id)
    pub async fn get_processing_lock(&self, hash: &str) -> Result<Option<String>> {
        let mut conn = self.conn.clone();
        let value: Option<String> = conn.get(format!("processing:{}", hash)).await?;
        Ok(value)
    }

    /// Release processing lock
    pub async fn release_processing_lock(&self, hash: &str) -> Result<()> {
        self.del(&format!("processing:{}", hash)).await
    }

    // ============ Cache Meta Operations ============

    /// Store cache metadata in Redis
    pub async fn set_cache_meta(
        &self,
        hash: &str,
        meta: &crate::models::CacheMetadata,
        ttl_seconds: u64,
    ) -> Result<()> {
        self.set_ex(&format!("cache:meta:{}", hash), meta, ttl_seconds)
            .await
    }

    /// Get cache metadata from Redis
    pub async fn get_cache_meta(
        &self,
        hash: &str,
    ) -> Result<Option<crate::models::CacheMetadata>> {
        self.get(&format!("cache:meta:{}", hash)).await
    }

    // ============ Parse Progress Operations ============

    /// Set parse progress for real-time status tracking
    pub async fn set_parse_progress(&self, hash: &str, progress: &ParseProgress) -> Result<()> {
        // 1 hour TTL for progress (cleanup after completion)
        self.set_ex(&format!("progress:{}", hash), progress, 3600).await
    }

    /// Get parse progress
    pub async fn get_parse_progress(&self, hash: &str) -> Result<Option<ParseProgress>> {
        self.get(&format!("progress:{}", hash)).await
    }

    /// Delete parse progress (cleanup)
    pub async fn del_parse_progress(&self, hash: &str) -> Result<()> {
        self.del(&format!("progress:{}", hash)).await
    }
}
