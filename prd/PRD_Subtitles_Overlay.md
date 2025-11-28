# PRD: Subtitles Overlay (WebVTT)

> **Objetivo**: Habilitar legendas externas via WebVTT renderizadas em overlay (HTML/CSS) sobre o vídeo, como fallback ou opção de customização quando as faixas embutidas não estão disponíveis ou não oferecem estilo suficiente.

## 1. Cenário de Uso
- Streams M3U/HLS/TS com faixas embutidas funcionam nativamente (LG/Samsung). Usar overlay apenas quando:
  - Não há faixas embutidas.
  - Usuário quer personalização além do que o player nativo oferece (fonte, cor, fundo, outline).
  - Legenda vem de fonte externa (OpenSubtitles via backend/proxy; arquivo .vtt/.srt fornecido).

## 2. Fontes de Legenda
- **Arquivo local/URL**: `.vtt` direto de um provedor (M3U indica? geralmente não).
- **Provedor externo**: backend/edge proxy busca no OpenSubtitles (API v2), converte `.srt` → `.vtt`, entrega como `text/vtt`.
- **Cache**: IndexedDB para reuso (TTL configurável).

## 3. Arquitetura
```
Player (HTML video ou AVPlay/webOS)
   ↓ currentTime polling (200-500ms)
SubtitleController (parse VTT, calc cues ativos)
   ↓ callbacks de render
SubtitleOverlay (React) → render cues em divs absolutas sobre o vídeo
```

### Componentes
- `SubtitleLoader`: baixa VTT (ou SRT e converte para VTT no backend), armazena no cache.
- `SubtitleParser`: parseia VTT (timestamps, texto, tags simples).
- `SubtitleController`: sincroniza com `currentTime` do player; calcula cues ativos e notifica a UI.
- `SubtitleOverlay`: componente React posicionado sobre o vídeo, aplica estilo custom (fonte, tamanho, cor, fundo, posição).

## 4. API do Player / Integração
- `usePlayer` deve expor `currentTime` atualizado (já existe).
- Adicionar hooks/métodos:
  - `setExternalSubtitle(url: string | null)`: carrega/limpa legendas externas.
  - `setSubtitleOverlayStyle(style: { fontSize, color, background, position })`.
- No adapter nativo, manter uso das faixas embutidas. Overlay só habilita quando selecionada uma faixa “externa” ou se não há faixas nativas.

## 5. UI/UX
- Menu de legendas:
  - “Desativado”
  - Faixas embutidas (nativas)
  - “Legenda externa (baixar)” → abre seleção (vinda do backend) ou campo URL.
  - Ajustes de estilo: tamanho (pequeno/normal/grande), cor (branco/amarelo), fundo (transparente/preto 50%), posição (inferior/superior).
- Overlay deve respeitar safe area e não bloquear controles.

## 6. Performance
- Polling de `currentTime` em 200-500ms é suficiente.
- Parse VTT uma vez; mantenha cues ordenadas para busca eficiente (binary search ou índice).
- Evitar re-render pesado: só atualizar overlay quando mudar o conjunto de cues ativos.

## 7. Backend (esboço)
- Endpoint `/subtitles/search`: usa OpenSubtitles (token no servidor), retorna lista com idioma/ID/URL VTT.
- Endpoint `/subtitles/fetch?id=...`: baixa legenda, converte para VTT, retorna `text/vtt` com CORS liberado.
- Proxy obrigatório: não expose credenciais no app/TV.

## 8. Critérios de Aceite
- Permitir seleção de legenda externa e renderizar em overlay sincronizado.
- Ajustes básicos de estilo funcionando (tamanho, cor, fundo, posição).
- Fallback para faixas embutidas continua intacto.
- Nenhum crash em TVs por uso de overlay (testar com polling moderado).

## 9. Riscos
- Drift de sincronização em redes instáveis (polling vs tempo real).
- Conversion issues: SRT → VTT (backend deve normalizar).
- Desempenho em TVs antigas: manter overlay simples (sem sombras/anim heavy).

## 10. Próximos Passos
- Implementar camada de overlay opcional (habilitar/disable).
- Integrar UI de seleção de legenda externa (consumindo backend fake/mock).
- Expor estilos básicos na UI.
- Medir desempenho em TV real antes de expandir customizações.
