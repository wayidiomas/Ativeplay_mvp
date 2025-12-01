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
pub use pool::{create_pool, health_check, run_migrations};
