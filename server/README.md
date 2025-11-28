# AtivePlay Bridge Server

Servidor intermediário para envio de playlist URL via QR code do celular para a TV.

## Como funciona

1. **TV** chama `POST /session/create` e recebe QR code
2. **Celular** escaneia QR code → abre página web `/s/:sessionId`
3. **Usuário** digita URL da playlist e envia via `POST /session/:id/send`
4. **TV** faz polling em `GET /session/:id/poll` a cada 2s até receber URL
5. **Sessão expira** em 5 minutos automaticamente

## Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Rodar servidor
npm start

# Dev com hot reload (Node 18+)
npm run dev
```

O servidor roda em `http://localhost:3001` por padrão.

## Deploy no Render

### 1. Criar conta no Render

Acesse [render.com](https://render.com) e crie uma conta gratuita.

### 2. Criar novo Web Service

1. Clique em **"New +"** → **"Web Service"**
2. Conecte seu repositório GitHub
3. Selecione a pasta `server/` como **Root Directory**

### 3. Configurar Build & Deploy

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
npm start
```

**Environment:**
- Deixe `Node` selecionado

### 4. Adicionar variável de ambiente

Em **Environment** → **Add Environment Variable**:

- **Key**: `BASE_URL`
- **Value**: `https://seu-app.onrender.com` (após deploy, copie a URL gerada)

**Importante**: Após o primeiro deploy, volte e atualize `BASE_URL` com a URL real do Render.

### 5. Deploy gratuito

- Escolha o plano **Free**
- Clique em **"Create Web Service"**

O servidor ficará em: `https://ativeplay-bridge.onrender.com` (ou nome escolhido)

### 6. Atualizar app da TV

No projeto principal, adicione a URL do servidor:

**`.env.local`** (desenvolvimento):
```env
VITE_BRIDGE_URL=http://localhost:3001
```

**`.env.production`** (produção):
```env
VITE_BRIDGE_URL=https://seu-app.onrender.com
```

## Endpoints da API

### `POST /session/create`
Cria nova sessão e retorna QR code.

**Response:**
```json
{
  "sessionId": "a1b2c3d4e5f6",
  "qrDataUrl": "data:image/png;base64,...",
  "mobileUrl": "https://server.com/s/a1b2c3d4e5f6",
  "expiresAt": 1234567890000
}
```

### `GET /session/:id/poll`
TV consulta se URL foi enviada.

**Response (aguardando):**
```json
{
  "url": null,
  "received": false
}
```

**Response (recebida):**
```json
{
  "url": "http://exemplo.com/playlist.m3u",
  "received": true
}
```

### `POST /session/:id/send`
Celular envia URL da playlist.

**Request:**
```json
{
  "url": "http://exemplo.com/playlist.m3u"
}
```

**Response:**
```json
{
  "success": true,
  "message": "URL enviada com sucesso!"
}
```

### `GET /s/:id`
Página HTML para o celular enviar URL.

## Limitações do Free Tier (Render)

- ⏸️ **Cold start**: Servidor hiberna após 15 min de inatividade
- 🕐 **Wake up**: Primeiro request leva ~30s para acordar
- 💾 **RAM**: 512 MB
- ⏱️ **CPU**: Compartilhado
- 🔄 **Horas**: 750h/mês (suficiente para uso pessoal)

### Solução para Cold Start

Você pode usar serviços como [cron-job.org](https://cron-job.org) para fazer ping a cada 10 minutos:

```
GET https://seu-app.onrender.com/
```

Isso mantém o servidor acordado durante o horário de uso.

## Monitoramento

Acesse o dashboard do Render para:

- Ver logs em tempo real
- Monitorar uso de CPU/RAM
- Verificar uptime

## Segurança

- ✅ Sessões expiram em 5 minutos
- ✅ Limpeza automática de sessões expiradas
- ✅ CORS habilitado para todos os origins (ajuste se necessário)
- ✅ Validação de URL no lado do servidor

## Troubleshooting

### QR code não aparece na TV

1. Verifique se `VITE_BRIDGE_URL` está configurado corretamente
2. Abra o DevTools da TV e veja erros de rede
3. Teste a URL do servidor: `https://seu-app.onrender.com/`

### Celular escaneou mas TV não recebe

1. Verifique se a sessão não expirou (5 min)
2. Confirme que a TV está fazendo polling (veja logs no Render)
3. Teste manualmente: `GET https://seu-app.onrender.com/session/ABC123/poll`

### Cold start muito lento

Use um serviço de ping (cron-job.org) para manter o servidor acordado.

## Desenvolvimento

### Testar localmente

1. **Terminal 1** (servidor):
```bash
cd server
npm run dev
```

2. **Terminal 2** (app da TV):
```bash
npm run dev
```

3. **Celular**: Acesse `http://SEU_IP_LOCAL:3001/s/teste123`

### Estrutura de Sessões

```typescript
interface Session {
  url: string | null;
  createdAt: number;
  expiresAt: number;
}

const sessions = Map<string, Session>
```

Em produção, considere usar **Redis** ou **Upstash** para persistência.

## Próximos Passos

- [ ] Adicionar rate limiting
- [ ] Implementar Redis para sessões (escalabilidade)
- [ ] Adicionar autenticação opcional
- [ ] Melhorar página mobile com PWA
- [ ] Adicionar analytics (quantas sessões/dia)

## Licença

MIT
