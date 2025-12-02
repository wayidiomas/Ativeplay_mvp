//! Xtream Codes API Client
//!
//! HTTP client for making requests to Xtream Codes Player API v2.

use super::types::*;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::time::Duration;
use tracing::{debug, error};

/// Default request timeout
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Xtream API Client
///
/// Provides methods for all Xtream Player API v2 endpoints.
pub struct XtreamClient {
    http: Client,
    base_url: String,
}

impl XtreamClient {
    /// Create a new Xtream client
    ///
    /// # Arguments
    /// * `server` - Server base URL (e.g., "http://example.com:8080")
    /// * `username` - Xtream username
    /// * `password` - Xtream password
    pub fn new(server: &str, username: &str, password: &str) -> Self {
        let base_url = format!(
            "{}/player_api.php?username={}&password={}",
            server.trim_end_matches('/'),
            username,
            password
        );

        let http = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .danger_accept_invalid_certs(true)
            .build()
            .expect("Failed to create HTTP client");

        Self { http, base_url }
    }

    /// Create from credentials struct
    pub fn from_credentials(creds: &XtreamCredentials) -> Self {
        Self::new(&creds.server, &creds.username, &creds.password)
    }

    /// Make a GET request with optional action parameter
    async fn get<T: DeserializeOwned>(&self, action: &str) -> Result<T, XtreamError> {
        let url = if action.is_empty() {
            self.base_url.clone()
        } else {
            format!("{}&action={}", self.base_url, action)
        };

        debug!("Xtream API request: {}", action);

        let response = self
            .http
            .get(&url)
            .header("User-Agent", "AtivePlay/1.0")
            .send()
            .await
            .map_err(|e| XtreamError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(XtreamError::Http(status.as_u16()));
        }

        let text = response
            .text()
            .await
            .map_err(|e| XtreamError::Network(e.to_string()))?;

        // Handle empty responses (some endpoints return empty for no results)
        if text.is_empty() || text == "[]" || text == "null" {
            return Err(XtreamError::EmptyResponse);
        }

        serde_json::from_str(&text).map_err(|e| {
            error!(
                "Failed to parse Xtream response for action '{}': {}",
                action, e
            );
            debug!("Response text: {}", &text[..text.len().min(500)]);
            XtreamError::Parse(e.to_string())
        })
    }

    // ========================================================================
    // Authentication
    // ========================================================================

    /// Get authentication info (user_info + server_info)
    pub async fn get_auth(&self) -> Result<XtreamAuthResponse, XtreamError> {
        self.get("").await
    }

    // ========================================================================
    // Categories
    // ========================================================================

    /// Get live stream categories
    pub async fn get_live_categories(&self) -> Result<Vec<XtreamCategory>, XtreamError> {
        self.get("get_live_categories").await
    }

    /// Get VOD categories
    pub async fn get_vod_categories(&self) -> Result<Vec<XtreamCategory>, XtreamError> {
        self.get("get_vod_categories").await
    }

    /// Get series categories
    pub async fn get_series_categories(&self) -> Result<Vec<XtreamCategory>, XtreamError> {
        self.get("get_series_categories").await
    }

    // ========================================================================
    // Live Streams
    // ========================================================================

    /// Get all live streams
    pub async fn get_live_streams(&self) -> Result<Vec<XtreamLiveStream>, XtreamError> {
        self.get("get_live_streams").await
    }

    /// Get live streams by category
    pub async fn get_live_streams_by_category(
        &self,
        category_id: &str,
    ) -> Result<Vec<XtreamLiveStream>, XtreamError> {
        self.get(&format!("get_live_streams&category_id={}", category_id))
            .await
    }

    // ========================================================================
    // VOD (Movies)
    // ========================================================================

    /// Get all VOD streams
    pub async fn get_vod_streams(&self) -> Result<Vec<XtreamVodStream>, XtreamError> {
        self.get("get_vod_streams").await
    }

    /// Get VOD streams by category
    pub async fn get_vod_streams_by_category(
        &self,
        category_id: &str,
    ) -> Result<Vec<XtreamVodStream>, XtreamError> {
        self.get(&format!("get_vod_streams&category_id={}", category_id))
            .await
    }

    /// Get detailed VOD info
    pub async fn get_vod_info(&self, vod_id: i64) -> Result<XtreamVodInfo, XtreamError> {
        self.get(&format!("get_vod_info&vod_id={}", vod_id)).await
    }

    // ========================================================================
    // Series
    // ========================================================================

    /// Get all series
    pub async fn get_series(&self) -> Result<Vec<XtreamSeries>, XtreamError> {
        self.get("get_series").await
    }

    /// Get series by category
    pub async fn get_series_by_category(
        &self,
        category_id: &str,
    ) -> Result<Vec<XtreamSeries>, XtreamError> {
        self.get(&format!("get_series&category_id={}", category_id))
            .await
    }

    /// Get detailed series info with episodes
    pub async fn get_series_info(&self, series_id: i64) -> Result<XtreamSeriesInfo, XtreamError> {
        self.get(&format!("get_series_info&series_id={}", series_id))
            .await
    }

    // ========================================================================
    // EPG
    // ========================================================================

    /// Get short EPG for a stream (next ~4 hours)
    pub async fn get_short_epg(
        &self,
        stream_id: i64,
        limit: Option<i32>,
    ) -> Result<XtreamEpgListings, XtreamError> {
        let mut action = format!("get_short_epg&stream_id={}", stream_id);
        if let Some(l) = limit {
            action.push_str(&format!("&limit={}", l));
        }
        self.get(&action).await
    }

    /// Get EPG for all streams (simple)
    pub async fn get_simple_data_table(
        &self,
        stream_id: i64,
    ) -> Result<XtreamEpgListings, XtreamError> {
        self.get(&format!("get_simple_data_table&stream_id={}", stream_id))
            .await
    }
}

/// Xtream API Error types
#[derive(Debug)]
pub enum XtreamError {
    /// Network/connection error
    Network(String),
    /// HTTP error (non-2xx status)
    Http(u16),
    /// JSON parsing error
    Parse(String),
    /// Empty response from server
    EmptyResponse,
}

impl std::fmt::Display for XtreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            XtreamError::Network(e) => write!(f, "Network error: {}", e),
            XtreamError::Http(code) => write!(f, "HTTP error: {}", code),
            XtreamError::Parse(e) => write!(f, "Parse error: {}", e),
            XtreamError::EmptyResponse => write!(f, "Empty response"),
        }
    }
}

impl std::error::Error for XtreamError {}

// Implement conversion to axum's IntoResponse for route handlers
impl From<XtreamError> for String {
    fn from(err: XtreamError) -> Self {
        err.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_url_construction() {
        let client = XtreamClient::new("http://example.com:8080", "user", "pass");
        assert!(client
            .base_url
            .starts_with("http://example.com:8080/player_api.php"));
        assert!(client.base_url.contains("username=user"));
        assert!(client.base_url.contains("password=pass"));
    }

    #[test]
    fn test_client_url_trailing_slash() {
        let client = XtreamClient::new("http://example.com:8080/", "user", "pass");
        // Should not have double slash
        assert!(!client.base_url.contains("//player_api"));
    }
}
