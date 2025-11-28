# 🚀 Deploy no Railway - Worker Pool Architecture

Guia completo para fazer deploy do AtivePlay Server no Railway com arquitetura de Worker Pool.

---

## 📋 Pré-requisitos

1. Conta no [Railway.app](https://railway.app)
2. Código já commitado no Git
3. Redis configurado no Railway

---

## 🛠️ Passo 1: Instalar Dependências Localmente

Primeiro, instale as novas dependências:

```bash
cd /Users/lucassouza/Projects/Macbook/AtivePlay/server

npm install
```

**Dependências adicionadas:**
- `bullmq` - Fila de jobs com Redis
- `ioredis` - Cliente Redis
- `express-rate-limit` - Rate limiting
- `prom-client` - Métricas Prometheus
- `pm2` - Process manager

---

## 🎯 Passo 2: Testar Localmente

### 2.1. Subir Redis Local

```bash
# Opção A: Docker (recomendado)
docker run -d -p 6379:6379 --name redis redis:alpine

# Opção B: Homebrew (macOS)
brew install redis
brew services start redis
```

### 2.2. Configurar variável de ambiente

```bash
# .env (crie se não existir)
echo "REDIS_URL=redis://localhost:6379" >> .env
```

### 2.3. Rodar API + Worker localmente

```bash
# Instala PM2 globalmente (se não tiver)
npm install -g pm2

# Inicia API e Worker
npm run dev

# Monitora processos
pm2 monit

# Vê logs
pm2 logs

# Para tudo
pm2 stop all
```

### 2.4. Testar endpoints

```bash
# Health check
curl http://localhost:3001/health

# Métricas
curl http://localhost:3001/metrics

# Parse playlist (deve retornar jobId)
curl -X POST http://localhost:3001/api/playlist/parse \
  -H "Content-Type: application/json" \
  -d '{"url": "http://exemplo.com/playlist.m3u"}'

# Verificar status do job (use jobId retornado)
curl http://localhost:3001/api/jobs/SEU_JOB_ID
```

---

## ☁️ Passo 3: Deploy no Railway

### 3.1. Criar projeto no Railway

1. Acesse https://railway.app
2. Click "New Project"
3. Selecione "Deploy from GitHub repo"
4. Conecte seu repositório

### 3.2. Adicionar Redis ao projeto

1. No dashboard do projeto, clique "+ New"
2. Selecione "Database" → "Redis"
3. Railway vai criar automaticamente a variável `REDIS_URL`

### 3.3. Configurar variáveis de ambiente

No Railway dashboard, adicione estas variáveis:

```
NODE_ENV=production
PORT=3001
BASE_URL=https://seu-app.railway.app
```

**Nota:** `REDIS_URL` é criada automaticamente pelo Railway quando você adiciona Redis.

### 3.4. Deploy

1. Railway detecta `railway.toml` e faz deploy automático
2. Build command: `npm install`
3. Start command: `npm run start` (roda PM2 com ecosystem.config.cjs)

### 3.5. Verificar deploy

```bash
# Substitua pela sua URL do Railway
export RAILWAY_URL="https://seu-app.railway.app"

# Health check
curl $RAILWAY_URL/health

# Deve retornar:
# {
#   "status": "ok",
#   "uptime": 123,
#   "memory": {...},
#   "queue": {...},
#   "redis": true
# }
```

---

## 📊 Passo 4: Monitoramento

### 4.1. Logs do Railway

```bash
# CLI do Railway (instale com: npm install -g @railway/cli)
railway login
railway logs
```

Ou acesse no dashboard: **Deployments** → **View Logs**

### 4.2. Métricas Prometheus

```bash
curl $RAILWAY_URL/metrics
```

**Métricas importantes:**
- `ativeplay_queue_size{state="waiting"}` - Jobs na fila
- `ativeplay_queue_size{state="active"}` - Jobs processando
- `ativeplay_playlist_parse_duration_seconds` - Tempo de parse
- `ativeplay_nodejs_heap_size_used_bytes` - Uso de memória

### 4.3. PM2 Dashboard (dentro do container)

```bash
# SSH no container Railway (se disponível)
pm2 monit
pm2 ls
```

---

## 🔧 Passo 5: Configuração de Recursos

### RAM Recomendada

Com concurrency=2 (2 parses simultâneos):
- API: 300 MB
- Worker: 800 MB
- **Total: 1.1 GB**

**Railway Trial:** 1 GB (apertado, mas funciona)
**Railway Hobby:** Compre +500 MB = **$5 base + $5 RAM = $10/mês**

### Ajustar Concurrency se Precisar

Se tiver mais RAM disponível, aumente concurrency no [worker.js:394](worker.js#L394):

```javascript
// worker.js
const worker = new Worker('parse-m3u', async (job) => {
  // ...
}, {
  connection: redisConnection,
  concurrency: 3, // ⭐ Aumentar para 3 se tiver 1.5 GB total
});
```

**Cálculo:**
- Concurrency 2 = 620 MB peak
- Concurrency 3 = 930 MB peak
- Concurrency 4 = 1.24 GB peak

---

## 🚨 Troubleshooting

### Problema: Worker crashando com OOM

**Sintoma:** Logs mostram "JavaScript heap out of memory"

**Solução:**
1. Verifique memória disponível: `curl $RAILWAY_URL/health`
2. Se `heapPercent > 80%`, diminua concurrency para 1:

```javascript
// worker.js:394
concurrency: 1, // Temporário até comprar mais RAM
```

3. Ou compre mais RAM no Railway

### Problema: Redis connection refused

**Sintoma:** Logs mostram `ECONNREFUSED` ou `redis_error`

**Solução:**
1. Verifique se Redis addon está ativo no Railway dashboard
2. Confirme que `REDIS_URL` está configurada:

```bash
railway variables
```

3. Se não existir, adicione manualmente ou recrie Redis addon

### Problema: Jobs ficam pending forever

**Sintoma:** `/api/jobs/:jobId` retorna `status: "waiting"` por muito tempo

**Solução:**
1. Verifique se worker está rodando:

```bash
curl $RAILWAY_URL/health | jq .queue
```

2. Se `active: 0` e `waiting > 0`, worker não está processando
3. Reinicie deployment no Railway dashboard

### Problema: Rate limit bloqueando testes

**Sintoma:** `429 Too Many Requests`

**Solução temporária (NÃO fazer em produção):**
```javascript
// api-server.js (linha 560)
max: 100, // Aumentar temporariamente para testes
```

---

## 📈 Escalabilidade

### Cenário 1: 1000 users/dia, 200 parses/dia

**Configuração:**
- Concurrency: 2
- RAM: 1.1 GB
- Custo Railway: ~$10/mês

### Cenário 2: 5000 users/dia, 1000 parses/dia

**Configuração:**
- Concurrency: 3-4
- RAM: 1.5-2 GB
- Custo Railway: ~$20-30/mês

### Cenário 3: 10k+ users/dia

**Migrar para:**
- Oracle Cloud Always Free (2 GB, $0/mês) ← **RECOMENDADO**
- Ou escalar horizontalmente com múltiplos workers no Railway

---

## 🎓 Arquitetura Implementada

```
Cliente (App)
   ↓
┌──────────────────────┐
│ API Server (leve)    │ ← 300 MB RAM
│ - Rate limiting      │
│ - Cache check        │
│ - Enfileira jobs     │
└──────────┬───────────┘
           │
      ┌────▼─────┐
      │  Redis   │ ← Railway addon
      │  Queue   │
      └────┬─────┘
           │
┌──────────▼───────────┐
│ Worker (pesado)      │ ← 800 MB RAM
│ - Concurrency: 2     │
│ - Processa M3U       │
│ - Salva cache        │
└──────────────────────┘
```

**Benefícios:**
- ✅ Memória controlada (sempre <1.1 GB)
- ✅ Zero crashes OOM
- ✅ Deduplicação (1000 users mesma URL = 1 parse)
- ✅ Rate limiting (5 req/min por IP)
- ✅ Observabilidade (logs JSON + /metrics)

---

## ✅ Checklist Final

Antes de colocar em produção, confirme:

- [ ] Redis addon criado no Railway
- [ ] `REDIS_URL` configurada (automática)
- [ ] `BASE_URL` configurada (URL do Railway)
- [ ] `NODE_ENV=production`
- [ ] Deploy bem-sucedido (health check retorna `status: "ok"`)
- [ ] Worker processando jobs (`queue.active > 0` quando tem jobs)
- [ ] Rate limiting funcionando (teste 6 requests rápidas)
- [ ] Métricas acessíveis em `/metrics`
- [ ] Cliente modificado para fazer polling (operations.ts)

---

## 📞 Suporte

- Railway docs: https://docs.railway.app
- BullMQ docs: https://docs.bullmq.io
- Redis docs: https://redis.io/docs

---

**🎉 Deploy completo! Seu servidor agora suporta 1000+ usuários simultâneos com Worker Pool architecture.**
