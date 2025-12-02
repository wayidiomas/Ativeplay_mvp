//! Cleanup service for expired playlists and watch history
//!
//! Runs as a background task on startup, then periodically.
//! - Deletes playlists where expires_at < NOW()
//! - Cleans up old watch history entries (keeps last N per device)

use chrono::Utc;
use sqlx::PgPool;
use std::time::Duration;
use tokio::time;

/// Configuration for the cleanup service
pub struct CleanupConfig {
    /// How often to run cleanup (in seconds)
    pub interval_secs: u64,
    /// Maximum watch history items to keep per device
    pub max_watch_history_per_device: i64,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            interval_secs: 3600, // Run every hour
            max_watch_history_per_device: 100,
        }
    }
}

/// Delete expired playlists (where expires_at < NOW())
/// Returns the number of deleted playlists
pub async fn cleanup_expired_playlists(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let now = Utc::now();

    // Delete playlists where expires_at is past
    // CASCADE will automatically delete related items, groups, series, episodes
    let result = sqlx::query(
        r#"
        DELETE FROM playlists
        WHERE expires_at IS NOT NULL AND expires_at < $1
        "#,
    )
    .bind(now)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() as i64)
}

/// Cleanup old watch history entries, keeping only the most recent N per device
/// Returns the number of deleted entries
pub async fn cleanup_watch_history(
    pool: &PgPool,
    keep_count: i64,
) -> Result<i64, sqlx::Error> {
    // Uses the cleanup_watch_history database function if it exists,
    // otherwise falls back to a manual query
    let result: Result<(i32,), _> = sqlx::query_as("SELECT cleanup_watch_history($1)")
        .bind(keep_count as i32)
        .fetch_one(pool)
        .await;

    match result {
        Ok((count,)) => Ok(count as i64),
        Err(_) => {
            // Function doesn't exist, use manual cleanup
            // This is less efficient but works without the function
            let result = sqlx::query(
                r#"
                WITH ranked AS (
                    SELECT id,
                           ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY watched_at DESC) as rn
                    FROM watch_history
                )
                DELETE FROM watch_history
                WHERE id IN (SELECT id FROM ranked WHERE rn > $1)
                "#,
            )
            .bind(keep_count)
            .execute(pool)
            .await?;

            Ok(result.rows_affected() as i64)
        }
    }
}

/// Run a single cleanup cycle
pub async fn run_cleanup(pool: &PgPool, config: &CleanupConfig) -> CleanupResult {
    let mut result = CleanupResult::default();

    // Cleanup expired playlists
    match cleanup_expired_playlists(pool).await {
        Ok(count) => {
            result.playlists_deleted = count;
            if count > 0 {
                tracing::info!("Cleanup: deleted {} expired playlists", count);
            }
        }
        Err(e) => {
            result.errors.push(format!("Playlist cleanup failed: {}", e));
            tracing::error!("Cleanup: playlist cleanup failed: {}", e);
        }
    }

    // Cleanup old watch history
    match cleanup_watch_history(pool, config.max_watch_history_per_device).await {
        Ok(count) => {
            result.watch_history_deleted = count;
            if count > 0 {
                tracing::info!("Cleanup: deleted {} old watch history entries", count);
            }
        }
        Err(e) => {
            result.errors.push(format!("Watch history cleanup failed: {}", e));
            tracing::error!("Cleanup: watch history cleanup failed: {}", e);
        }
    }

    result
}

/// Result of a cleanup operation
#[derive(Debug, Default)]
pub struct CleanupResult {
    pub playlists_deleted: i64,
    pub watch_history_deleted: i64,
    pub errors: Vec<String>,
}

impl CleanupResult {
    pub fn is_success(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn total_deleted(&self) -> i64 {
        self.playlists_deleted + self.watch_history_deleted
    }
}

/// Start the background cleanup task
///
/// Runs immediately on startup, then periodically at the configured interval.
/// This should be spawned as a background task using `tokio::spawn`.
pub async fn start_cleanup_task(pool: PgPool, config: CleanupConfig) {
    tracing::info!(
        "Starting cleanup task (interval: {}s, max_history: {})",
        config.interval_secs,
        config.max_watch_history_per_device
    );

    // Run immediately on startup
    let result = run_cleanup(&pool, &config).await;
    if result.total_deleted() > 0 {
        tracing::info!(
            "Initial cleanup complete: {} playlists, {} watch history entries deleted",
            result.playlists_deleted,
            result.watch_history_deleted
        );
    }

    // Then run periodically
    let mut interval = time::interval(Duration::from_secs(config.interval_secs));

    loop {
        interval.tick().await;

        let result = run_cleanup(&pool, &config).await;
        if !result.is_success() {
            for error in &result.errors {
                tracing::warn!("Cleanup error: {}", error);
            }
        }
    }
}
