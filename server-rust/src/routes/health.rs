use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use prometheus::{Encoder, TextEncoder};
use serde::Serialize;
use std::sync::Arc;

use crate::db;
use crate::AppState;

/// Root endpoint - basic status
pub async fn root() -> impl IntoResponse {
    Json(serde_json::json!({
        "name": "AtivePlay Server",
        "version": "1.0.0",
        "status": "running",
        "runtime": "rust"
    }))
}

/// Memory stats
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryStats {
    used_mb: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    peak_mb: Option<u64>,
}

/// Cache stats
#[derive(Serialize)]
struct CacheStats {
    entries: usize,
    size_mb: f64,
}

/// Health check response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: String,
    uptime: u64,
    memory: MemoryStats,
    postgres: bool,
    redis: bool,
    cache: CacheStats,
}

/// GET /health - Advanced health check
pub async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // Calculate uptime
    let uptime = state.start_time.elapsed().as_secs();

    // Check PostgreSQL connection
    let postgres_ok = db::health_check(&state.pool).await;

    // Check Redis connection
    let redis_ok = match state.redis.ping().await {
        Ok(pong) => pong,
        Err(_) => false,
    };

    // Get cache stats
    let cache_count = state.cache.get_cache_count().await;
    let cache_size = state.cache.get_cache_size().await.unwrap_or(0);
    let cache_size_mb = cache_size as f64 / 1024.0 / 1024.0;

    // Get memory usage (approximate)
    // In Rust we can't easily get heap usage like Node.js, but we can provide placeholder
    // In production, you might use jemalloc stats or similar
    let memory = MemoryStats {
        used_mb: 0, // Would need platform-specific code or jemalloc
        peak_mb: None,
    };

    // Status: ok only if all critical services are healthy
    let status = if postgres_ok && redis_ok {
        "ok"
    } else if postgres_ok {
        "degraded" // Redis is optional for some operations
    } else {
        "unhealthy" // PostgreSQL is critical
    };

    let health = HealthResponse {
        status: status.to_string(),
        uptime,
        memory,
        postgres: postgres_ok,
        redis: redis_ok,
        cache: CacheStats {
            entries: cache_count,
            size_mb: (cache_size_mb * 100.0).round() / 100.0,
        },
    };

    Json(health)
}

/// GET /metrics - Prometheus metrics
pub async fn metrics() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();

    let mut buffer = Vec::new();
    match encoder.encode(&metric_families, &mut buffer) {
        Ok(_) => (
            StatusCode::OK,
            [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
            buffer,
        ),
        Err(e) => {
            tracing::error!("Failed to encode metrics: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [("content-type", "text/plain")],
                b"Internal Server Error".to_vec(),
            )
        }
    }
}

/// Readiness probe (for Kubernetes)
pub async fn ready(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // PostgreSQL is critical for all operations
    let postgres_ok = db::health_check(&state.pool).await;
    let redis_ok = state.redis.ping().await.unwrap_or(false);

    if postgres_ok && redis_ok {
        (StatusCode::OK, "ready")
    } else if postgres_ok {
        // Redis down but Postgres ok - degraded but operational
        (StatusCode::OK, "ready (redis degraded)")
    } else if redis_ok {
        (StatusCode::SERVICE_UNAVAILABLE, "not ready - postgres unavailable")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "not ready - postgres and redis unavailable")
    }
}

/// Liveness probe (for Kubernetes)
pub async fn live() -> impl IntoResponse {
    (StatusCode::OK, "alive")
}
