//! Xtream Codes URL Detection and Validation
//!
//! Detects if an M3U URL is from an Xtream Codes server and validates credentials.

use super::types::{XtreamAuthResponse, XtreamCredentials};
use reqwest::Client;
use std::time::Duration;
use tracing::{debug, info, warn};
use url::Url;

/// Request timeout for Xtream API calls
const XTREAM_TIMEOUT_SECS: u64 = 10;

/// Extract Xtream credentials from an M3U URL
///
/// Supported URL patterns:
/// - `http://server:port/get.php?username=X&password=Y&...`
/// - `http://server:port/get.php?username=X&password=Y&type=m3u_plus&output=ts`
///
/// # Returns
/// - `Some(XtreamCredentials)` if URL matches Xtream pattern
/// - `None` if URL is not an Xtream M3U URL
pub fn extract_credentials(m3u_url: &str) -> Option<XtreamCredentials> {
    let parsed = match Url::parse(m3u_url) {
        Ok(url) => url,
        Err(e) => {
            debug!("Failed to parse URL: {}", e);
            return None;
        }
    };

    // Check if it's a get.php endpoint (typical Xtream pattern)
    let path = parsed.path().to_lowercase();
    if !path.contains("/get.php") {
        debug!("URL path does not contain /get.php: {}", path);
        return None;
    }

    // Extract query parameters
    let params: std::collections::HashMap<_, _> = parsed.query_pairs().collect();

    // Must have both username and password
    let username = params.get("username")?.to_string();
    let password = params.get("password")?.to_string();

    if username.is_empty() || password.is_empty() {
        debug!("Empty username or password in URL");
        return None;
    }

    // Reconstruct server base URL
    let host = parsed.host_str()?;
    let scheme = parsed.scheme();
    let port_suffix = parsed
        .port()
        .map(|p| format!(":{}", p))
        .unwrap_or_default();

    let server = format!("{}://{}{}", scheme, host, port_suffix);

    debug!(
        "Extracted Xtream credentials: server={}, username={}",
        server, username
    );

    Some(XtreamCredentials {
        server,
        username,
        password,
    })
}

/// Validate Xtream credentials by calling the player_api.php endpoint
///
/// Makes a request to `{server}/player_api.php?username=X&password=Y`
/// and checks if the response contains valid user_info.
///
/// # Returns
/// - `Ok(XtreamAuthResponse)` if credentials are valid and account is active
/// - `Err(String)` with error message if validation fails
pub async fn validate_credentials(creds: &XtreamCredentials) -> Result<XtreamAuthResponse, String> {
    let url = creds.api_url();

    debug!("Validating Xtream credentials at: {}", url);

    let client = Client::builder()
        .timeout(Duration::from_secs(XTREAM_TIMEOUT_SECS))
        .danger_accept_invalid_certs(true) // Many Xtream servers have self-signed certs
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("User-Agent", "AtivePlay/1.0")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Connection timeout - server did not respond".to_string()
            } else if e.is_connect() {
                "Connection failed - server unreachable".to_string()
            } else {
                format!("Request failed: {}", e)
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP error: {}", status));
    }

    // Try to parse as JSON
    let text = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    // Some servers return HTML error pages instead of JSON
    if text.trim().starts_with('<') {
        return Err("Server returned HTML instead of JSON - likely invalid credentials".to_string());
    }

    let auth: XtreamAuthResponse = serde_json::from_str(&text).map_err(|e| {
        debug!("Failed to parse response as XtreamAuthResponse: {}", e);
        debug!("Response text: {}", &text[..text.len().min(500)]);
        format!("Invalid JSON response: {}", e)
    })?;

    // Check account status
    if !auth.user_info.is_active() {
        return Err(format!(
            "Account not active. Status: {}",
            auth.user_info.status
        ));
    }

    info!(
        "Xtream credentials validated successfully. Account: {}, Status: {}, Expires: {:?}",
        auth.user_info.username,
        auth.user_info.status,
        auth.user_info.exp_date
    );

    Ok(auth)
}

/// Detect and validate if a URL is an Xtream Codes source
///
/// This is the main entry point for Xtream detection. It:
/// 1. Extracts credentials from the M3U URL
/// 2. Validates them against the Xtream API
///
/// # Returns
/// - `Some((credentials, auth_response))` if URL is valid Xtream
/// - `None` if URL is not Xtream or credentials are invalid
pub async fn detect_xtream(url: &str) -> Option<(XtreamCredentials, XtreamAuthResponse)> {
    // Step 1: Try to extract credentials from URL
    let creds = extract_credentials(url)?;

    debug!(
        "Detected potential Xtream URL, validating credentials for server: {}",
        creds.server
    );

    // Step 2: Validate credentials
    match validate_credentials(&creds).await {
        Ok(auth) => {
            info!(
                "Confirmed Xtream source: {} (account: {})",
                creds.server, auth.user_info.username
            );
            Some((creds, auth))
        }
        Err(e) => {
            warn!(
                "URL has Xtream pattern but validation failed: {}. Falling back to M3U parse.",
                e
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_credentials_valid() {
        let url = "http://example.com:8080/get.php?username=testuser&password=testpass&type=m3u_plus&output=ts";
        let creds = extract_credentials(url).expect("Should extract credentials");

        assert_eq!(creds.server, "http://example.com:8080");
        assert_eq!(creds.username, "testuser");
        assert_eq!(creds.password, "testpass");
    }

    #[test]
    fn test_extract_credentials_https() {
        let url = "https://secure.example.com/get.php?username=user&password=pass";
        let creds = extract_credentials(url).expect("Should extract credentials");

        assert_eq!(creds.server, "https://secure.example.com");
        assert_eq!(creds.username, "user");
        assert_eq!(creds.password, "pass");
    }

    #[test]
    fn test_extract_credentials_no_port() {
        let url = "http://example.com/get.php?username=user&password=pass";
        let creds = extract_credentials(url).expect("Should extract credentials");

        assert_eq!(creds.server, "http://example.com");
    }

    #[test]
    fn test_extract_credentials_not_xtream() {
        // Regular M3U URL
        let url = "http://example.com/playlist.m3u";
        assert!(extract_credentials(url).is_none());

        // No get.php
        let url = "http://example.com/api/streams?username=user&password=pass";
        assert!(extract_credentials(url).is_none());
    }

    #[test]
    fn test_extract_credentials_missing_params() {
        // Missing password
        let url = "http://example.com/get.php?username=user";
        assert!(extract_credentials(url).is_none());

        // Missing username
        let url = "http://example.com/get.php?password=pass";
        assert!(extract_credentials(url).is_none());
    }

    #[test]
    fn test_credentials_url_builders() {
        let creds = XtreamCredentials {
            server: "http://example.com:8080".to_string(),
            username: "user".to_string(),
            password: "pass".to_string(),
        };

        assert_eq!(
            creds.api_url(),
            "http://example.com:8080/player_api.php?username=user&password=pass"
        );

        assert_eq!(
            creds.live_url(123),
            "http://example.com:8080/live/user/pass/123.ts"
        );

        assert_eq!(
            creds.vod_url(456, "mkv"),
            "http://example.com:8080/movie/user/pass/456.mkv"
        );

        assert_eq!(
            creds.series_url(789, "mp4"),
            "http://example.com:8080/series/user/pass/789.mp4"
        );

        assert_eq!(
            creds.epg_url(),
            "http://example.com:8080/xmltv.php?username=user&password=pass"
        );
    }
}
