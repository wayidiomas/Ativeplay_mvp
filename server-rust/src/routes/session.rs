use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::Luma;
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

/// GET /s/:id - Mobile HTML page to enter playlist URL
pub async fn mobile_page(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Check if session exists in Redis
    let session = state.redis.get_session(&id).await.ok().flatten();

    if session.is_none() {
        return Html(expired_html());
    }

    Html(form_html(&id))
}

fn form_html(session_id: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AtivePlay - Adicionar Playlist</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .container {{
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            padding: 32px;
            width: 100%;
            max-width: 400px;
            border: 1px solid rgba(255,255,255,0.1);
        }}
        h1 {{
            color: #fff;
            font-size: 24px;
            margin-bottom: 8px;
            text-align: center;
        }}
        .subtitle {{
            color: rgba(255,255,255,0.6);
            font-size: 14px;
            text-align: center;
            margin-bottom: 24px;
        }}
        .input-group {{
            margin-bottom: 16px;
        }}
        label {{
            display: block;
            color: rgba(255,255,255,0.8);
            font-size: 14px;
            margin-bottom: 8px;
        }}
        input {{
            width: 100%;
            padding: 14px 16px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: #fff;
            font-size: 16px;
        }}
        input::placeholder {{ color: rgba(255,255,255,0.4); }}
        input:focus {{
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99,102,241,0.2);
        }}
        button {{
            width: 100%;
            padding: 14px;
            border-radius: 8px;
            border: none;
            background: #6366f1;
            color: #fff;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 8px;
        }}
        button:hover {{ background: #5558e3; }}
        button:disabled {{
            background: #4b4b5c;
            cursor: not-allowed;
        }}
        .status {{
            text-align: center;
            margin-top: 16px;
            font-size: 14px;
            min-height: 20px;
        }}
        .status.success {{ color: #22c55e; }}
        .status.error {{ color: #ef4444; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>AtivePlay</h1>
        <p class="subtitle">Insira o link da sua playlist M3U</p>
        <form id="form">
            <div class="input-group">
                <label for="url">URL da Playlist</label>
                <input type="url" id="url" name="url"
                    placeholder="http://exemplo.com/playlist.m3u" required>
            </div>
            <button type="submit" id="submit">Enviar para TV</button>
        </form>
        <p class="status" id="status"></p>
    </div>
    <script>
        const form = document.getElementById('form');
        const status = document.getElementById('status');
        const submit = document.getElementById('submit');
        const sessionId = '{session_id}';

        form.addEventListener('submit', async (e) => {{
            e.preventDefault();
            const url = document.getElementById('url').value.trim();
            if (!url) return;

            submit.disabled = true;
            submit.textContent = 'Enviando...';
            status.textContent = '';
            status.className = 'status';

            try {{
                const res = await fetch('/session/' + sessionId + '/send', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ url }})
                }});

                if (res.ok) {{
                    status.textContent = 'Enviado! Verifique sua TV.';
                    status.className = 'status success';
                    submit.textContent = 'Enviado!';
                }} else {{
                    throw new Error('Falha ao enviar');
                }}
            }} catch (err) {{
                status.textContent = 'Erro ao enviar. Tente novamente.';
                status.className = 'status error';
                submit.disabled = false;
                submit.textContent = 'Enviar para TV';
            }}
        }});
    </script>
</body>
</html>"#)
}

fn expired_html() -> String {
    r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sessao Expirada</title>
    <style>
        body {
            font-family: -apple-system, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            text-align: center;
            padding: 20px;
        }
        .icon { font-size: 48px; margin-bottom: 16px; }
        h2 { margin-bottom: 8px; }
        p { color: rgba(255,255,255,0.6); }
    </style>
</head>
<body>
    <div>
        <div class="icon">&#8987;</div>
        <h2>Sessao Expirada</h2>
        <p>Gere um novo QR code na sua TV e escaneie novamente.</p>
    </div>
</body>
</html>"#.to_string()
}
