# Fix: Canais Live "Arquivo Não Suportado"

## Data: 2025-12-02

## Problema

Alguns canais de TV ao vivo (Globo, SBT, Record, etc) exibiam erro "arquivo não suportado" enquanto outros canais funcionavam normalmente.

## Causa Raiz

A função `isIptvTsStream()` em `src/player/adapters/LGWebOSAdapter.ts` não detectava corretamente URLs do tipo `/play/TOKEN` como streams MPEG-TS.

### Padrões de URL Identificados

| Tipo | Formato URL | Detectado? |
|------|-------------|------------|
| Canais 24h | `/play/TOKEN/ts` | SIM |
| TV Real (Globo, SBT) | `/play/TOKEN` | **NÃO** |

URLs sem o sufixo `/ts` caíam no fallback de playback HTML5 direto, que não suporta streams MPEG-TS raw.

## Solução

Adicionados dois novos padrões de detecção na função `isIptvTsStream()`:

```typescript
// Pattern: /play/TOKEN format (common IPTV pattern for live channels)
// TOKEN is typically base64 or alphanumeric, at least 20 chars to avoid false positives
// Examples: /play/ABC123... (Globo, SBT, Record live channels)
if (/\/play\/[a-zA-Z0-9+/=_-]{20,}(\?|$)/i.test(originalUrl)) return true;

// Pattern: /live/ path without extension (common IPTV live pattern)
if (/\/live\/[^.]+(\?|$)/i.test(originalUrl)) return true;
```

### Lógica de Detecção

1. **Exclusões** (NÃO é TS stream):
   - URLs com extensão de arquivo (`.m3u8`, `.mp4`, `.mkv`)
   - URLs com paths VOD (`/movie/`, `/series/`, `/vod/`, `/episode/`)

2. **Inclusões** (É TS stream):
   - Termina com `/ts`
   - Padrão Xtream Codes `/digits/digits/digits`
   - Query param `output=ts`
   - **NOVO**: `/play/TOKEN` com TOKEN >= 20 caracteres
   - **NOVO**: `/live/` path sem extensão

## Arquivo Modificado

- `src/player/adapters/LGWebOSAdapter.ts` (linhas 140-145)

## Fluxo de Playback

```
URL Live → isHlsUrl()? → NÃO
         → isIptvTsStream()? → SIM (detecta /play/TOKEN)
         → Carrega como IPTV TS stream
         → Inicia TS recovery monitor
         → ✓ Reproduz corretamente
```

## Testes Recomendados

1. Testar canais que terminam com `/ts` (devem continuar funcionando)
2. Testar canais sem `/ts` (Globo, SBT, Record - devem funcionar agora)
3. Testar VOD (filmes/séries) - devem continuar usando HLS.js
4. Testar canais HLS (`.m3u8`) - devem continuar usando HLS.js

## Rollback

Se necessário reverter, remover as linhas 140-145 do arquivo `LGWebOSAdapter.ts`.
