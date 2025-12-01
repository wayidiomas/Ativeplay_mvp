//! Database connection pool management

use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;
use tracing::{info, error};

use crate::config::Config;

/// Create a PostgreSQL connection pool
pub async fn create_pool(config: &Config) -> Result<PgPool, sqlx::Error> {
    info!("Connecting to PostgreSQL...");

    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .connect(&config.database_url)
        .await?;

    info!("PostgreSQL connection pool created with max {} connections", config.db_max_connections);

    Ok(pool)
}

/// Run database migrations
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    info!("Running database migrations...");

    sqlx::migrate!("./migrations")
        .run(pool)
        .await?;

    info!("Database migrations completed");

    Ok(())
}

/// Health check for the database
pub async fn health_check(pool: &PgPool) -> bool {
    match sqlx::query("SELECT 1")
        .fetch_one(pool)
        .await
    {
        Ok(_) => true,
        Err(e) => {
            error!("Database health check failed: {}", e);
            false
        }
    }
}
