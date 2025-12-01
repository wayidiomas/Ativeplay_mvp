use serde::{Deserialize, Serialize};

/// QR Session data stored in Redis
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub created_at: i64,
}

/// Response for session creation
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: String,
    pub qr_data_url: String,
    pub mobile_url: String,
    pub expires_at: i64,
}

/// Response for session polling
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollSessionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub received: bool,
}

/// Request to send URL to session
#[derive(Debug, Deserialize)]
pub struct SendUrlRequest {
    pub url: String,
}

/// Response for send URL
#[derive(Debug, Serialize)]
pub struct SendUrlResponse {
    pub success: bool,
    pub message: String,
}

/// Generic API response
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message.into()),
        }
    }
}
