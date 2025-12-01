use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageBuffer, Luma};
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

/// Response for session creation
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionResponse {
    session_id: String,
    qr_data_url: String,
    mobile_url: String,
    expires_at: i64,
}

/// Response for session poll
#[derive(Serialize)]
struct PollSessionResponse {
    url: Option<String>,
    received: bool,
}

/// Request to send URL
#[derive(Deserialize)]
pub struct SendUrlRequest {
    pub url: String,
}

/// Generate QR code as data URL
fn generate_qr_data_url(content: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Generate QR code
    let code = QrCode::new(content.as_bytes())?;

    // Render to image
    let image = code.render::<Luma<u8>>()
        .min_dimensions(300, 300)
        .dark_color(Luma([0u8]))
        .light_color(Luma([255u8]))
        .quiet_zone(true)
        .build();

    // Encode to PNG
    let mut png_buffer = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_buffer);
    encoder.encode(
        image.as_raw(),
        image.width(),
        image.height(),
        image::ColorType::L8,
    )?;

    // Convert to data URL
    let base64_data = STANDARD.encode(&png_buffer);
    Ok(format!("data:image/png;base64,{}", base64_data))
}

/// POST /session/create - Create a new session and return QR code
pub async fn create_session(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Generate unique session ID (12 hex characters)
    let session_id = Uuid::new_v4().to_string()[..12].to_string();

    // Calculate expiration time (15 minutes)
    let now = chrono::Utc::now().timestamp_millis();
    let expires_at = now + (state.config.session_ttl_seconds * 1000) as i64;

    // Generate mobile URL
    let mobile_url = format!("{}/s/{}", state.config.base_url, session_id);

    // Create session in Redis
    state
        .redis
        .create_session(&session_id, state.config.session_ttl_seconds)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create session: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao criar sessão" })),
            )
        })?;

    // Generate QR code
    let qr_data_url = generate_qr_data_url(&mobile_url).map_err(|e| {
        tracing::error!("Failed to generate QR code: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Erro ao gerar QR code" })),
        )
    })?;

    tracing::info!("Session created: {} (expires in {}s)", session_id, state.config.session_ttl_seconds);

    Ok(Json(CreateSessionResponse {
        session_id,
        qr_data_url,
        mobile_url,
        expires_at,
    }))
}

/// GET /session/:id/poll - TV polls for URL from mobile
pub async fn poll_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Get session from Redis
    let session = state
        .redis
        .get_session(&id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get session: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao buscar sessão" })),
            )
        })?;

    match session {
        None => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Sessão não encontrada ou expirada" })),
        )),
        Some(session) => {
            if let Some(url) = session.url {
                tracing::info!("Session {} - URL received by TV", id);
                // Delete session after URL is retrieved
                let _ = state.redis.del(&format!("session:{}", id)).await;
                Ok(Json(PollSessionResponse {
                    url: Some(url),
                    received: true,
                }))
            } else {
                Ok(Json(PollSessionResponse {
                    url: None,
                    received: false,
                }))
            }
        }
    }
}

/// POST /session/:id/send - Mobile sends URL
pub async fn send_url(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SendUrlRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Validate URL
    if payload.url.is_empty() || !payload.url.starts_with("http") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "URL inválida" })),
        ));
    }

    // Check if session exists
    let session = state
        .redis
        .get_session(&id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get session: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao buscar sessão" })),
            )
        })?;

    if session.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Sessão não encontrada ou expirada" })),
        ));
    }

    // Update session with URL
    state
        .redis
        .set_session_url(&id, &payload.url, state.config.session_ttl_seconds)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set session URL: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Erro ao enviar URL" })),
            )
        })?;

    tracing::info!("Session {} - URL sent by mobile", id);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "URL enviada com sucesso!"
    })))
}
