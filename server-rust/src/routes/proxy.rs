use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    Json,
};
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

use crate::AppState;

// Re-export reqwest header module to avoid version conflicts
mod reqwest_header {
    pub use reqwest::header::{
        ACCEPT, ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE,
        ETAG, LAST_MODIFIED, RANGE, REFERER,
    };
}

/// Query parameters for HLS proxy
#[derive(Deserialize)]
pub struct HlsProxyQuery {
    pub url: String,
    #[serde(default)]
    pub referer: Option<String>,
}

/// Guess content type from URL
fn guess_content_type(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if lower.contains(".mp4") {
        "video/mp4"
    } else if lower.contains(".mkv") {
        "video/x-matroska"
    } else if lower.contains(".avi") {
        "video/x-msvideo"
    } else if lower.contains(".ts") {
        "video/MP2T"
    } else {
        "video/MP2T"
    }
}

/// Validate URL is HTTP/HTTPS
fn is_valid_http_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// GET /api/proxy/hls?url=<encoded>&referer=<optional>
/// Lightweight proxy for HLS (manifest/segments) with passthrough of essential headers.
/// Purpose: bypass CORS and ensure correct Content-Type without storing data in memory/disk.
pub async fn hls_proxy(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HlsProxyQuery>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    // Validate URL
    if query.url.is_empty() || !is_valid_http_url(&query.url) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Parâmetro url inválido" })),
        ));
    }

    // Create client with timeout
    let client = Client::builder()
        .timeout(Duration::from_millis(state.config.hls_proxy_timeout_ms))
        .user_agent(&state.config.user_agent)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| {
            tracing::error!("Failed to create HTTP client: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro interno" })),
            )
        })?;

    // Build upstream request
    let mut request = client.get(&query.url);

    // Forward essential headers (using reqwest's header constants)
    if let Some(accept) = headers.get(header::ACCEPT) {
        if let Ok(accept_str) = accept.to_str() {
            request = request.header(reqwest_header::ACCEPT, accept_str);
        }
    } else {
        request = request.header(reqwest_header::ACCEPT, "*/*");
    }

    // Forward Range header for partial content requests
    if let Some(range) = headers.get(header::RANGE) {
        if let Ok(range_str) = range.to_str() {
            request = request.header(reqwest_header::RANGE, range_str);
        }
    }

    // Add referer if provided
    if let Some(ref referer) = query.referer {
        request = request.header(reqwest_header::REFERER, referer);
    }

    // Execute request
    let upstream_response = request.send().await.map_err(|e| {
        let status = if e.is_timeout() {
            StatusCode::GATEWAY_TIMEOUT
        } else {
            StatusCode::BAD_GATEWAY
        };
        tracing::error!("HLS proxy error for {}: {}", query.url, e);
        (
            status,
            Json(serde_json::json!({
                "error": "Falha ao proxyficar HLS",
                "detail": e.to_string()
            })),
        )
    })?;

    let upstream_status = upstream_response.status();

    // Get content type (from response or guess from URL)
    let content_type = upstream_response
        .headers()
        .get(reqwest_header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| guess_content_type(&query.url).to_string());

    // Build response headers
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::CONTENT_TYPE,
        content_type.parse().unwrap_or_else(|_| "video/MP2T".parse().unwrap()),
    );
    response_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        "*".parse().unwrap(),
    );
    response_headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        "Content-Length, Content-Type, Accept-Ranges".parse().unwrap(),
    );

    // Forward optional headers from upstream (use reqwest constants for reading, axum for writing)
    if let Some(content_length) = upstream_response.headers().get(reqwest_header::CONTENT_LENGTH) {
        if let Ok(cl) = content_length.to_str() {
            if let Ok(parsed) = cl.parse() {
                response_headers.insert(header::CONTENT_LENGTH, parsed);
            }
        }
    }

    if let Some(accept_ranges) = upstream_response.headers().get(reqwest_header::ACCEPT_RANGES) {
        if let Ok(ar) = accept_ranges.to_str() {
            if let Ok(parsed) = ar.parse() {
                response_headers.insert(header::ACCEPT_RANGES, parsed);
            }
        }
    }

    if let Some(etag) = upstream_response.headers().get(reqwest_header::ETAG) {
        if let Ok(e) = etag.to_str() {
            if let Ok(parsed) = e.parse() {
                response_headers.insert(header::ETAG, parsed);
            }
        }
    }

    if let Some(last_modified) = upstream_response.headers().get(reqwest_header::LAST_MODIFIED) {
        if let Ok(lm) = last_modified.to_str() {
            if let Ok(parsed) = lm.parse() {
                response_headers.insert(header::LAST_MODIFIED, parsed);
            }
        }
    }

    // Stream the body back
    let body = Body::from_stream(upstream_response.bytes_stream());

    // Build response
    let mut response = Response::builder()
        .status(StatusCode::from_u16(upstream_status.as_u16()).unwrap_or(StatusCode::OK));

    for (key, value) in response_headers.iter() {
        response = response.header(key, value);
    }

    response.body(body).map_err(|e| {
        tracing::error!("Failed to build response: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Erro interno" })),
        )
    })
}
