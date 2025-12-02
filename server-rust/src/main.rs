mod config;
mod db;
mod models;
mod routes;
mod services;

use axum::{
    routing::{delete, get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::db::{create_pool, run_migrations};
use crate::services::{
    cache::CacheService,
    cleanup::{start_cleanup_task, CleanupConfig},
    db_cache::DbCacheService,
    m3u_parser::M3UParser,
    redis::RedisService,
};
use sqlx::PgPool;

/// Application state shared across handlers
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
    pub redis: RedisService,
    pub cache: CacheService,
    pub db_cache: DbCacheService,
    pub parser: M3UParser,
    pub start_time: Instant,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing/logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ativeplay_server=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    // Load configuration
    let config = Config::from_env();
    let port = config.port;

    tracing::info!("Starting AtivePlay Server v{}", env!("CARGO_PKG_VERSION"));
    tracing::info!("Environment: {}", config.node_env);

    // Initialize PostgreSQL connection pool
    let pool = create_pool(&config).await?;
    tracing::info!("PostgreSQL connected");

    // Run database migrations
    run_migrations(&pool).await?;
    tracing::info!("Database migrations completed");

    // Initialize services
    let redis = RedisService::new(&config.redis_url).await?;
    tracing::info!("Redis connected: {}", config.redis_url);

    // Disk-based cache (kept for backward compatibility/fallback)
    let cache = CacheService::new(
        &config.parse_cache_dir,
        config.parse_cache_max_entries,
        config.parse_cache_max_mb.map(|mb| mb * 1024 * 1024),
    )
    .await?;
    tracing::info!("Disk cache initialized: {}", config.parse_cache_dir);

    // PostgreSQL-based cache (primary storage)
    let db_cache = DbCacheService::new(pool.clone());
    tracing::info!("Database cache initialized");

    // Initialize M3U parser with PostgreSQL storage
    let parser = M3UParser::new(
        cache.clone(),
        db_cache.clone(),
        &config.user_agent,
        config.fetch_timeout_ms,
        config.parse_cache_ttl_ms,
        config.max_retries,
        config.max_m3u_size_mb,
    );
    tracing::info!("M3U parser initialized with PostgreSQL storage");

    // Start cleanup task (runs in background)
    let cleanup_pool = pool.clone();
    tokio::spawn(start_cleanup_task(cleanup_pool, CleanupConfig::default()));
    tracing::info!("Cleanup task started (hourly)");

    // Build application state
    let state = Arc::new(AppState {
        config,
        pool,
        redis,
        cache,
        db_cache,
        parser,
        start_time: Instant::now(),
    });

    // Build router
    let app = Router::new()
        // Health endpoints
        .route("/", get(routes::health::root))
        .route("/health", get(routes::health::health_check))
        .route("/metrics", get(routes::health::metrics))
        .route("/ready", get(routes::health::ready))
        .route("/live", get(routes::health::live))
        // Session endpoints (QR code)
        .route("/session/create", post(routes::session::create_session))
        .route("/session/:id/poll", get(routes::session::poll_session))
        .route("/session/:id/send", post(routes::session::send_url))
        .route("/s/:id", get(routes::session::mobile_page))
        // Playlist endpoints
        .route("/api/playlist/parse", post(routes::playlist::parse_playlist))
        .route(
            "/api/playlist/:hash/groups",
            get(routes::playlist::get_groups),
        )
        .route(
            "/api/playlist/:hash/items",
            get(routes::playlist::get_items),
        )
        .route(
            "/api/playlist/:hash/series",
            get(routes::playlist::get_series),
        )
        .route(
            "/api/playlist/:hash/stats",
            get(routes::playlist::get_stats),
        )
        .route(
            "/api/playlist/:hash/validate",
            get(routes::playlist::validate_cache),
        )
        .route(
            "/api/playlist/:hash/series/:series_id/episodes",
            get(routes::playlist::get_series_episodes),
        )
        .route(
            "/api/playlist/:hash/search",
            get(routes::playlist::search_items),
        )
        .route(
            "/api/playlist/:hash/status",
            get(routes::playlist::get_parse_status),
        )
        // Admin endpoints (protected by ADMIN_KEY)
        .route(
            "/api/admin/playlist/:hash",
            delete(routes::admin::delete_playlist),
        )
        .route("/api/admin/all", delete(routes::admin::delete_all_data))
        .route("/api/admin/stats", get(routes::admin::get_db_stats))
        .route("/api/admin/expired", delete(routes::admin::delete_expired))
        // HLS Proxy
        .route("/api/proxy/hls", get(routes::proxy::hls_proxy))
        // Xtream Codes Proxy routes (for Xtream playlists)
        .route(
            "/api/xtream/:playlist_id/info",
            get(routes::xtream::get_playlist_info),
        )
        .route(
            "/api/xtream/:playlist_id/categories/:type",
            get(routes::xtream::get_categories),
        )
        .route(
            "/api/xtream/:playlist_id/streams/:type",
            get(routes::xtream::get_streams),
        )
        .route(
            "/api/xtream/:playlist_id/vod/:vod_id",
            get(routes::xtream::get_vod_info),
        )
        .route(
            "/api/xtream/:playlist_id/series/:series_id",
            get(routes::xtream::get_series_info),
        )
        .route(
            "/api/xtream/:playlist_id/play-url",
            get(routes::xtream::get_play_url),
        )
        // Watch History endpoints
        .route(
            "/api/watch-history/sync",
            post(routes::watch_history::sync_watch_history),
        )
        .route(
            "/api/watch-history/:device_id",
            get(routes::watch_history::get_watch_history)
                .delete(routes::watch_history::clear_watch_history),
        )
        .route(
            "/api/watch-history/:device_id/:item_hash",
            delete(routes::watch_history::delete_history_item),
        )
        // Middleware
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
