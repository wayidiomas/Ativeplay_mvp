//! Xtream Codes Integration
//!
//! This module provides integration with Xtream Codes Player API v2.
//!
//! # Overview
//!
//! Xtream Codes is a popular IPTV management system. This module provides:
//!
//! - **Detection**: Identify Xtream URLs from M3U playlist URLs
//! - **Validation**: Verify credentials against Xtream servers
//! - **API Client**: Make requests to all Xtream Player API endpoints
//!
//! # URL Pattern Detection
//!
//! Xtream M3U URLs typically follow this pattern:
//! ```text
//! http://server:port/get.php?username=X&password=Y&type=m3u_plus&output=ts
//! ```
//!
//! When detected, we can use the Player API directly instead of parsing the M3U:
//! ```text
//! http://server:port/player_api.php?username=X&password=Y
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! use crate::services::xtream::{detect_xtream, XtreamClient};
//!
//! // Try to detect if URL is Xtream
//! if let Some((creds, auth)) = detect_xtream(&url).await {
//!     // It's Xtream! Use the API client
//!     let client = XtreamClient::from_credentials(&creds);
//!     let categories = client.get_vod_categories().await?;
//! } else {
//!     // Not Xtream, parse as regular M3U
//! }
//! ```

pub mod client;
pub mod detector;
pub mod types;

// Re-exports for convenience
pub use client::{XtreamClient, XtreamError};
pub use detector::{detect_xtream, extract_credentials, validate_credentials};
pub use types::{
    XtreamAuthResponse, XtreamCategory, XtreamCredentials, XtreamEpisode, XtreamEpisodeInfo,
    XtreamEpgEntry, XtreamEpgListings, XtreamLiveStream, XtreamSeason, XtreamSeries,
    XtreamSeriesDetails, XtreamSeriesInfo, XtreamServerInfo, XtreamUserInfo, XtreamVodDetails,
    XtreamVodInfo, XtreamVodStream,
};
