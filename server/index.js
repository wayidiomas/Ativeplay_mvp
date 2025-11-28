/**
 * AtivePlay Bridge Server
 * Servidor intermediário para envio de playlist URL via QR code
 */

import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Detecta IP local da máquina na rede
 */
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Pula endereços internos e não IPv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Armazena sessões ativas (em produção, usar Redis)
// Estrutura: { sessionId: { url: null, createdAt: timestamp, expiresAt: timestamp } }
const sessions = new Map();

// Limpa sessões expiradas a cada minuto
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(sessionId);
      console.log(`[Session] Expirada e removida: ${sessionId}`);
    }
  }
}, 60000);

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'AtivePlay Bridge',
    version: '1.0.0',
    status: 'online',
    activeSessions: sessions.size,
  });
});

/**
 * POST /session/create
 * Cria nova sessão e retorna QR code + sessionId
 */
app.post('/session/create', async (req, res) => {
  try {
    const sessionId = randomBytes(6).toString('hex'); // 12 caracteres
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutos

    // URL que será aberta no celular
    // Em produção usa BASE_URL (Render), em dev usa IP local
    const localIP = getLocalIP();
    const baseUrl = process.env.BASE_URL || `http://${localIP}:${PORT}`;
    const mobileUrl = `${baseUrl}/s/${sessionId}`;

    // Cria sessão
    sessions.set(sessionId, {
      url: null,
      createdAt: Date.now(),
      expiresAt,
    });

    // Gera QR code como Data URL
    const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    console.log(`[Session] Criada: ${sessionId} (expira em 5min)`);

    res.json({
      sessionId,
      qrDataUrl,
      mobileUrl,
      expiresAt,
    });
  } catch (error) {
    console.error('[Session] Erro ao criar:', error);
    res.status(500).json({ error: 'Erro ao criar sessão' });
  }
});

/**
 * GET /session/:id/poll
 * TV consulta periodicamente se recebeu URL
 */
app.get('/session/:id/poll', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada ou expirada' });
  }

  if (session.url) {
    // URL foi enviada, retorna e limpa sessão
    console.log(`[Session] URL recebida pela TV: ${id}`);
    const url = session.url;
    sessions.delete(id);
    return res.json({ url, received: true });
  }

  // Ainda aguardando
  res.json({ url: null, received: false });
});

/**
 * POST /session/:id/send
 * Celular envia URL da playlist
 */
app.post('/session/:id/send', (req, res) => {
  const { id } = req.params;
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL inválida' });
  }

  const session = sessions.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada ou expirada' });
  }

  // Armazena URL na sessão
  session.url = url;
  console.log(`[Session] URL enviada pelo celular: ${id}`);

  res.json({ success: true, message: 'URL enviada com sucesso!' });
});

/**
 * GET /s/:id
 * Página mobile para enviar URL
 */
app.get('/s/:id', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);

  if (!session) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AtivePlay - Sessão Expirada</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            color: white;
            text-align: center;
          }
          .container {
            max-width: 400px;
          }
          h1 { font-size: 3em; margin: 0; }
          p { font-size: 1.2em; opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⏰</h1>
          <p>Sessão expirada ou inválida</p>
          <p style="font-size: 0.9em;">Escaneie novamente o QR code na TV</p>
        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AtivePlay - Enviar Playlist</title>
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 30px;
          max-width: 400px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .logo {
          text-align: center;
          margin-bottom: 24px;
        }
        .logo h1 {
          color: #667eea;
          font-size: 2em;
          margin-bottom: 8px;
        }
        .logo p {
          color: #666;
          font-size: 0.9em;
        }
        label {
          display: block;
          color: #333;
          font-weight: 600;
          margin-bottom: 8px;
        }
        input {
          width: 100%;
          padding: 14px;
          border: 2px solid #e0e0e0;
          border-radius: 10px;
          font-size: 16px;
          transition: border-color 0.3s;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
        }
        button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 16px;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        button:active {
          transform: translateY(0);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .status {
          margin-top: 16px;
          padding: 12px;
          border-radius: 10px;
          text-align: center;
          font-weight: 500;
          display: none;
        }
        .status.success {
          background: #d4edda;
          color: #155724;
          display: block;
        }
        .status.error {
          background: #f8d7da;
          color: #721c24;
          display: block;
        }
        .hint {
          margin-top: 16px;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 10px;
          font-size: 0.85em;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <h1>📺 AtivePlay</h1>
          <p>Envie sua playlist para a TV</p>
        </div>

        <form id="playlistForm">
          <label for="url">URL da Playlist M3U</label>
          <input
            type="url"
            id="url"
            name="url"
            placeholder="https://exemplo.com/playlist.m3u"
            required
            autocomplete="off"
            autocapitalize="off"
          />

          <button type="submit" id="submitBtn">
            Enviar para TV
          </button>
        </form>

        <div id="status" class="status"></div>

        <div class="hint">
          💡 Cole a URL da sua playlist IPTV e envie para sua TV
        </div>
      </div>

      <script>
        const form = document.getElementById('playlistForm');
        const input = document.getElementById('url');
        const submitBtn = document.getElementById('submitBtn');
        const status = document.getElementById('status');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          const url = input.value.trim();
          if (!url) return;

          // Desabilita form
          submitBtn.disabled = true;
          submitBtn.textContent = 'Enviando...';
          status.className = 'status';
          status.style.display = 'none';

          try {
            const response = await fetch('/session/${id}/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });

            const data = await response.json();

            if (response.ok) {
              status.className = 'status success';
              status.textContent = '✅ ' + data.message;
              submitBtn.textContent = '✓ Enviado!';
              input.value = '';

              // Reabilita após 2s
              setTimeout(() => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Enviar outra URL';
              }, 2000);
            } else {
              throw new Error(data.error || 'Erro ao enviar');
            }
          } catch (error) {
            status.className = 'status error';
            status.textContent = '❌ ' + error.message;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Tentar novamente';
          }
        });
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log(`🚀 AtivePlay Bridge rodando na porta ${PORT}`);
  console.log(`📱 URL local: http://${localIP}:${PORT}`);
  console.log(`📱 URL base: ${process.env.BASE_URL || `http://${localIP}:${PORT}`}`);
});
