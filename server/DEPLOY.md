# Deploy AtivePlay Bridge Server no Render

## 📋 Pré-requisitos

- Conta no [Render](https://render.com) (gratuita)
- Repositório Git com o código (já temos: https://github.com/wayidiomas/Ativeplay_mvp.git)

## 🚀 Passo a Passo

### 1. Preparar o Repositório

O repositório já está pronto com:
- ✅ `server/package.json` com `"start": "node index.js"`
- ✅ `server/index.js` detecta IP local e usa `process.env.BASE_URL` em produção
- ✅ `engines.node` especificado no package.json

### 2. Criar Web Service no Render

1. Acesse https://dashboard.render.com/
2. Clique em **"New +"** → **"Web Service"**
3. Conecte seu repositório GitHub: `https://github.com/wayidiomas/Ativeplay_mvp`
4. Configure o serviço:

```
Name: ativeplay-bridge
Environment: Node
Region: Oregon (US West) ou escolha a mais próxima
Branch: main
Root Directory: server
Build Command: npm install
Start Command: npm start
```

### 3. Configurar Plano

- **Free Plan**: Adequado para testes (dorme após 15min de inatividade)
- **Starter Plan ($7/mês)**: Recomendado para produção (sempre ativo)

### 4. Variáveis de Ambiente

No Render Dashboard, vá em **Environment** e adicione:

```bash
# Obrigatória: URL pública do seu serviço (Render fornece automaticamente)
BASE_URL=https://ativeplay-bridge.onrender.com

# Opcional: Porta (Render define automaticamente, mas pode especificar)
PORT=10000
```

> **Nota**: O Render fornece a URL automaticamente após o deploy. Você precisará atualizar `BASE_URL` após o primeiro deploy.

### 5. Deploy

1. Clique em **"Create Web Service"**
2. Aguarde o build (2-3 minutos)
3. Após o deploy, copie a URL fornecida (ex: `https://ativeplay-bridge.onrender.com`)
4. Volte em **Environment** e atualize `BASE_URL` com essa URL

### 6. Configurar App TV

Após o deploy, atualize o arquivo `.env` do app TV:

```bash
# .env (local - para testes)
VITE_BRIDGE_URL=http://localhost:3001

# .env.production (produção)
VITE_BRIDGE_URL=https://ativeplay-bridge.onrender.com
```

Ou use variável condicional:

```typescript
// src/core/hooks/useQRSession.ts
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL ||
  (import.meta.env.PROD
    ? 'https://ativeplay-bridge.onrender.com'
    : 'http://localhost:3001');
```

### 7. Testar

1. Acesse `https://ativeplay-bridge.onrender.com/` - deve retornar JSON com status
2. Na TV, abra o app e vá para adicionar playlist
3. Escaneie o QR code com celular
4. Verifique se o QR code aponta para `https://ativeplay-bridge.onrender.com/s/[sessionId]`

## 🔧 Monitoramento

### Ver Logs

```bash
# No dashboard do Render
Vai em "Logs" → Acompanhe em tempo real
```

### Health Check

O Render automaticamente faz health check em `/`. O endpoint já retorna:

```json
{
  "service": "AtivePlay Bridge",
  "version": "1.0.0",
  "status": "online",
  "activeSessions": 0
}
```

## ⚡ Performance

### Free Plan
- **Limitações**: Dorme após 15min sem requisições
- **Cold Start**: ~30 segundos para acordar
- **Recomendado**: Apenas para desenvolvimento/testes

### Paid Plan ($7/mês)
- Sempre ativo
- 0 downtime
- SSL automático
- Custom domain

## 🔒 Segurança

### CORS

Já configurado para aceitar qualquer origem:

```javascript
app.use(cors());
```

Em produção, considere restringir:

```javascript
app.use(cors({
  origin: ['https://seu-dominio.com', 'http://192.168.0.0/16'],
  credentials: true
}));
```

### HTTPS

- Render fornece SSL/TLS automático
- Todos os endpoints são HTTPS

### Sessões

- Expiram automaticamente em 5 minutos
- Limpeza automática a cada 1 minuto
- Em produção, considere usar Redis para sessões distribuídas

## 🆘 Troubleshooting

### Problema: "Session não encontrada"

**Causa**: Free plan dormiu e sessões foram perdidas
**Solução**: Upgrade para paid plan ou implemente Redis

### Problema: QR code não funciona

**Causa**: `BASE_URL` não configurada
**Solução**: Adicione `BASE_URL` nas variáveis de ambiente

### Problema: Mobile não consegue acessar

**Causa 1**: URL do QR code aponta para localhost
**Solução**: Verifique se `BASE_URL` está configurada corretamente

**Causa 2**: CORS bloqueado
**Solução**: Verifique configuração de CORS no servidor

## 📝 Comandos Úteis

```bash
# Rodar localmente
cd server
npm install
npm run dev

# Testar endpoint de criação de sessão
curl -X POST http://localhost:3001/session/create

# Testar endpoint de polling
curl http://localhost:3001/session/[sessionId]/poll

# Enviar URL de teste
curl -X POST http://localhost:3001/session/[sessionId]/send \
  -H "Content-Type: application/json" \
  -d '{"url": "http://exemplo.com/playlist.m3u"}'
```

## 🔄 Atualizações

O Render faz deploy automático quando você faz push para o branch `main`:

```bash
git add .
git commit -m "feat: nova funcionalidade"
git push origin main
# Deploy automático inicia no Render
```

## 💰 Custos

- **Free Plan**: $0/mês (dorme após inatividade)
- **Starter Plan**: $7/mês (sempre ativo)
- **Standard Plan**: $25/mês (maior performance)

Para MVP inicial, Free Plan é suficiente para testes.
Para produção, recomendo Starter Plan.

## 📱 URL Final

Após deploy completo, sua URL será:

```
https://ativeplay-bridge.onrender.com
```

E o QR code apontará para:

```
https://ativeplay-bridge.onrender.com/s/[sessionId]
```

---

✅ **Pronto!** Seu servidor de QR code está no ar e acessível de qualquer celular com internet.
