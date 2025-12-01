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
use url::Url;
use tokio::time::timeout;

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

/// Check if content type indicates HLS manifest
fn is_hls_manifest(content_type: &str, url: &str) -> bool {
    let ct_lower = content_type.to_lowercase();
    let url_lower = url.to_lowercase();

    // Check content type
    if ct_lower.contains("mpegurl") || ct_lower.contains("x-mpegurl") {
        return true;
    }

    // Check URL extension
    if url_lower.contains(".m3u8") || url_lower.contains(".m3u") {
        return true;
    }

    false
}

/// Rewrite URLs in HLS manifest to go through proxy
/// This is essential for LG webOS TVs where Luna Service doesn't proxy sub-requests
fn rewrite_manifest_urls(manifest: &str, base_url: &str, proxy_base: &str, referer: Option<&str>) -> String {
    let base = match Url::parse(base_url) {
        Ok(u) => u,
        Err(_) => return manifest.to_string(),
    };

    let mut result = String::with_capacity(manifest.len() * 2);

    for line in manifest.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            result.push('\n');
            continue;
        }

        // Lines starting with # are tags/comments
        if trimmed.starts_with('#') {
            // Check for URI= attributes in tags (e.g., #EXT-X-KEY:URI="...")
            if trimmed.contains("URI=") {
                let rewritten = rewrite_uri_attribute(trimmed, &base, proxy_base, referer);
                result.push_str(&rewritten);
            } else {
                result.push_str(line);
            }
            result.push('\n');
            continue;
        }

        // Regular lines are URLs (relative or absolute)
        let absolute_url = resolve_url(trimmed, &base);
        let proxied = build_proxy_url(&absolute_url, proxy_base, referer);
        result.push_str(&proxied);
        result.push('\n');
    }

    result
}

/// Resolve a potentially relative URL against a base URL
fn resolve_url(url: &str, base: &Url) -> String {
    // Already absolute
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }

    // Resolve relative URL
    match base.join(url) {
        Ok(resolved) => resolved.to_string(),
        Err(_) => url.to_string(),
    }
}

/// Build a proxy URL for a given target URL
fn build_proxy_url(target_url: &str, proxy_base: &str, referer: Option<&str>) -> String {
    let encoded = urlencoding::encode(target_url);
    match referer {
        Some(r) => format!("{}/api/proxy/hls?url={}&referer={}", proxy_base, encoded, urlencoding::encode(r)),
        None => format!("{}/api/proxy/hls?url={}", proxy_base, encoded),
    }
}

/// Rewrite URI= attribute in HLS tags
fn rewrite_uri_attribute(line: &str, base: &Url, proxy_base: &str, referer: Option<&str>) -> String {
    // Find URI="..." pattern
    let uri_start = match line.find("URI=\"") {
        Some(pos) => pos + 5,
        None => return line.to_string(),
    };

    let rest = &line[uri_start..];
    let uri_end = match rest.find('"') {
        Some(pos) => pos,
        None => return line.to_string(),
    };

    let uri = &rest[..uri_end];
    let absolute_url = resolve_url(uri, base);
    let proxied = build_proxy_url(&absolute_url, proxy_base, referer);

    format!("{}URI=\"{}\"{}",
        &line[..uri_start],
        proxied,
        &line[uri_start + uri_end..])
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

    // Create client with no global response timeout (live TS needs to stream indefinitely)
    // Connection-level timeout is handled by reqwest defaults; manifest fetches are guarded below.
    let client = Client::builder()
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

    // Determine upfront if this looks like a manifest; only manifests get a total timeout.
    let looks_like_manifest = query.url.to_lowercase().contains(".m3u");

    // Execute request (manifest fetch wrapped with timeout, segments stream indefinitely)
    let upstream_response = if looks_like_manifest {
        timeout(
            Duration::from_millis(state.config.hls_proxy_timeout_ms),
            request.send(),
        )
        .await
        .map_err(|_| {
            tracing::error!("HLS proxy timeout for manifest {}", query.url);
            (
                StatusCode::GATEWAY_TIMEOUT,
                Json(serde_json::json!({
                    "error": "Falha ao proxyficar HLS",
                    "detail": "Timeout ao baixar manifest"
                })),
            )
        })?
    } else {
        request.send().await
    }
    .map_err(|e| {
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

    // Determine proxy base URL for rewriting manifest URLs
    let proxy_base = &state.config.base_url;

    // Check if this is an HLS manifest that needs URL rewriting
    let is_manifest = is_hls_manifest(&content_type, &query.url);

    // Build response headers (common for both manifest and binary)
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

    // For HLS manifests: read body, rewrite URLs, return modified content
    if is_manifest {
        let manifest_bytes = upstream_response.bytes().await.map_err(|e| {
            tracing::error!("Failed to read manifest body: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": "Falha ao ler manifest" })),
            )
        })?;

        let manifest_text = String::from_utf8_lossy(&manifest_bytes);

        // Rewrite URLs in manifest to go through proxy
        let rewritten = rewrite_manifest_urls(
            &manifest_text,
            &query.url,
            proxy_base,
            query.referer.as_deref(),
        );

        tracing::debug!("Rewritten HLS manifest for {}", query.url);

        // Update content length for rewritten manifest
        response_headers.insert(
            header::CONTENT_LENGTH,
            rewritten.len().to_string().parse().unwrap(),
        );

        let body = Body::from(rewritten);

        let mut response = Response::builder()
            .status(StatusCode::from_u16(upstream_status.as_u16()).unwrap_or(StatusCode::OK));

        for (key, value) in response_headers.iter() {
            response = response.header(key, value);
        }

        return response.body(body).map_err(|e| {
            tracing::error!("Failed to build response: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro interno" })),
            )
        });
    }

    // For binary content (segments, etc.): stream through
    // Forward optional headers from upstream
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
