# PRD: EPG (XMLTV) – Ingestão e Exibição

> **Objetivo**: Consumir o EPG em formato XMLTV (ex.: `xmltv.php?username=...&password=...`), cachear no app, exibir “Agora/Próximo” e grade básica em TV ao Vivo, com flag para desativar.

## 1. Escopo
- Baixar e parsear XMLTV.
- Match de programas com canais (via `tvg-id`; fallback por nome normalizado).
- Cache em IndexedDB com TTL.
- Exibir Agora/Próximo na lista de canais; grade do dia no detalhe do canal.
- Flag `VITE_ENABLE_EPG` para habilitar/desabilitar.
- Não quebra módulos existentes; operação silenciosa se desativado/erro.

## 2. Fontes e Config
- `VITE_EPG_URL`: URL completa do XMLTV (ex.: `http://llvr.lat/xmltv.php?username=...&password=...`).
- `VITE_ENABLE_EPG`: true/false.
- Em dev/browser, usar proxy (`/cors-proxy/<encodedUrl>` ou `VITE_DEV_PROXY_TARGET`) se CORS bloquear.

## 3. Modelos (IndexedDB)
- `epgPrograms`:
  - `id`: string (ex.: `${channelKey}_${start}`)
  - `channelId`: `tvg-id` ou hash do nome normalizado
  - `title`: string
  - `desc`: string (opcional)
  - `start`: timestamp (ms)
  - `end`: timestamp (ms)
  - `lang?`: string
  - Índices: `channelId`, `[channelId+start]`
- TTL: 6h (limpar programas com `end < now` e refetch se cache expirado).

## 4. Ingestão
1) Baixar XMLTV da URL (respeitando CORS via proxy em dev).
2) Parsear `<programme>`: `channel`, `start`, `stop`, `title`, `desc`.
3) Converter horários para timestamp ms (considerar timezone do XMLTV, geralmente +0000).
4) Normalizar `channel`:
   - Se item M3U tiver `tvg-id`, usar como chave.
   - Fallback: nome do canal normalizado (lowercase, sem pontuação/espacos extras).
5) Inserir em batch no IndexedDB, mantendo janela de 24-48h e removendo expirados.
6) Guardar timestamp do último fetch.

## 5. API/Serviço
- `epgService.fetchAndCache(epgUrl: string)`: baixa/parsa/cacheia, respeita TTL e limpeza.
- `epgService.getNowNext(channelKey: string, now = Date.now())`: retorna programa atual e próximo.
- `epgService.getSchedule(channelKey: string, day: Date)`: retorna lista do dia.
- Hook: `useEpg(channelId: string, channelName: string)` → expõe `now`, `next`, `schedule`, `isLoading`, `error`.

## 6. Integração UI
- **Lista de TV ao Vivo**: mostrar “Agora: Título (HH:MM)” e “Próximo: Título”.
- **Detalhe do canal**: grade do dia (start/end, título, desc curta).
- Fallback: “Sem EPG” se não houver dados/match.
- Respeitar flag: se `VITE_ENABLE_EPG=false`, esconder EPG e não baixar.

## 7. Performance
- Parse em streaming ou DOMParser leve; inserir em lotes (500-1000).
- Limitar range (24-48h) para evitar lotar IndexedDB.
- TTL 6h para refetch; limpar expirados a cada ingestão.

## 8. Erros e Resiliência
- Se fetch falhar, manter cache anterior se válido.
- Se parsing falhar, logar e não quebrar UI; re-tentar no próximo ciclo.
- CORS: na TV deve passar; em dev usar proxy.

## 9. Critérios de Aceite
- EPG habilitável via flag; não impacta se desligado.
- Programação “Agora/Próximo” exibida nos canais live quando há dados.
- Grade do dia disponível no detalhe do canal.
- Cache e TTL funcionando (não refaz download a cada navegação).

## 10. Próximos Passos
- Implementar serviço de ingestão/cache + hook `useEpg`.
- Integrar na UI de TV ao Vivo (lista e detalhe).
- Adicionar flag/URL ao `.env` (`VITE_EPG_URL`, `VITE_ENABLE_EPG`).
