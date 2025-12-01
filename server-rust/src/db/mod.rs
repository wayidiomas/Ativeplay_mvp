//! Database module
//!
//! PostgreSQL integration using sqlx with:
//! - Connection pool management
//! - Row types with FromRow
//! - Repository pattern for data access
//! - Streaming writes with COPY protocol

pub mod models;
pub mod pool;
pub mod repository;

// Re-export commonly used items
pub use models::PlaylistRow;
pub use pool::{create_pool, health_check, run_migrations};

use sqlx::PgPool;

/// Get playlist by hash (any client)
/// Convenience wrapper for status endpoint
pub async fn get_playlist_by_hash(
    pool: &PgPool,
    hash: &str,
) -> Result<Option<PlaylistRow>, sqlx::Error> {
    repository::playlists::find_by_hash_any(pool, hash).await
}
