# PRD: Módulo de Filmes

> **PRD ID**: PRD_Filmes  
> **Versão**: 1.0  
> **Referências**: PRD Master v1.1, PRD_Parsing v1.1, PRD_Onboarding v1.1, PRD_Home v1.0.0, PRD_Player v2.0, PRD_Dependencies v1.0  
> **Status**: Especificação Completa  
> **Data**: 2025-11-26

---

## 1. Objetivo

Entregar a experiência premium de filmes no AtivePlay para TVs Samsung Tizen e LG webOS, com catálogo organizado, detalhes ricos e reprodução rápida, utilizando dados do M3U e enriquecimento TMDB sem comprometer performance em dispositivos limitados.

### 1.1 Metas
- Descoberta fácil de filmes com navegação via D-PAD.
- Tela de detalhes cinematográfica com sinopse, ano, rating e artes em alta.
- Continuar de onde parou (Continue Watching) e favoritar filmes.
- Garantir start do player em 1-3s com seleção de áudio/legenda embutidos.

### 1.2 Fora de Escopo
- Séries (PRD_Series).
- TV ao Vivo (PRD_LiveTV).
- DRM/legendagem externa (arquivos .srt).

---

## 2. Fontes de Dados

| Origem | Uso | Observações |
|--------|-----|-------------|
| IndexedDB `items` | Base do catálogo de filmes (`mediaKind = 'movie'`). | Proveniente do parser (PRD_Parsing). |
| IndexedDB `groups` | Filtros por grupo/categoria do provedor. | Normalizados via `displayName`. |
| IndexedDB `favorites` | Lista de favoritos por playlist. | CRUD local, sem rede. |
| IndexedDB `watchProgress` | Continue Watching e posição de retomada. | Atualizado pelo player. |
| TMDB API (on-demand) | Sinopse, ano, rating, poster, backdrop. | Cache local (TTL 30d detalhes, 7d busca). |
| M3U item | Fallback: `tvg-name`, `tvg-logo`, `group-title`. | Sempre disponível. |

---

## 3. Fluxo do Usuário

```
Home → Filmes (categoria) → Grade de filmes
   ↓
Seleciona card → Tela de Detalhes
   ↓
[Assistir] → Player (continua do progresso salvo se existir)
   ↓
Sai do player → Progresso salvo → Aparece em Continue Watching
```

---

## 4. Catálogo de Filmes (Lista/Grade)

### 4.1 Layout (1920x1080)
```
┌───────────────────────────────────────────────────────────────┐
│  HEADER: "Filmes" | [Filtro: Todos] [Ordenar: A-Z] [Grupo ▼]   │
├───────────────────────────────────────────────────────────────┤
│  Grade 5 col x N linhas (scroll vertical)                     │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                      │
│  │POST │ │POST │ │POST │ │POST │ │POST │                      │
│  │ER   │ │ER   │ │ER   │ │ER   │ │ER   │                      │
│  ├─────┤ ├─────┤ ├─────┤ ├─────┤ ├─────┤                      │
│  │Títu │ │Títu │ │Títu │ │Títu │ │Títu │                      │
│  │lo   │ │lo   │ │lo   │ │lo   │ │lo   │                      │
│  │2024 │ │★7.1 │ │65%  │ │     │ │     │                      │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                      │
│  ...                                                          │
└───────────────────────────────────────────────────────────────┘
```

### 4.2 Card de Filme
| Elemento | Fonte | Detalhe |
|----------|-------|---------|
| Poster 2:3 | `tmdb.poster_path` → `tvg-logo` → placeholder | Lazy load; blur-up opcional. |
| Título | TMDB `title` → `tvg-name` | Truncate 1 linha. |
| Ano | TMDB `release_date` → regex do título | |
| Rating | TMDB `vote_average` | Mostrar ★ com 1 decimal. |
| Progresso | `watchProgress.progress` | Mostrar barra se 5%-95%. |
| Badges | Áudio/Legendas disponíveis (síntese do parser) | Mostrar ícones se tracks > 1 / legendas presentes. |
| Grupo | `group.displayName` (cinza) | Opcional, 2ª linha. |

### 4.3 Filtros e Ordenação
- **Filtros rápidos**: Todos, Favoritos, Continue Watching, Recentes (ordenar por `updatedAt`), Baixados (N/A).
- **Grupo/Categoria**: dropdown/selector usando `groups` com `mediaKind = 'movie'`.
- **Ordenação**: A-Z, Z-A, Ano (desc), Rating (desc), Últimos assistidos (`watchProgress.lastWatched`).
- Persistir última seleção no `homeStore`/`playlistStore` (localStorage).

### 4.4 Paginação/Virtualização
- Virtualização horizontal e vertical (usar `@tanstack/react-virtual` já previsto em PRD_Home) para listas grandes.
- Page size sugerido: 50 itens carregados por vez; pré-carregar +20 ao chegar a 80% do scroll.

---

## 5. Tela de Detalhes do Filme

### 5.1 Layout
```
┌───────────────────────────────────────────────────────────────┐
│ BACKDROP (TMDB ou blur do poster)                             │
│  Gradient left→right                                           │
│                                                               │
│  Poster (grande)  | Título (48px) [Ano] [Rating ★7.9]         │
│                   | Duração • Gêneros • Grupo                 │
│                   | Sinopse (3-4 linhas, truncate)            │
│                   |                                           │
│                   | [▶ Assistir] [★ Favoritar] [ℹ Trailer]    │
│                   | [Áudio: 2 faixas] [Legendas: 2]           │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 Conteúdo
| Campo | Fonte | Fallback |
|-------|-------|----------|
| Título | TMDB `title` | `tvg-name` |
| Ano | TMDB `release_date` | regex no `tvg-name` |
| Duração | TMDB `runtime` | ocultar se ausente |
| Sinopse | TMDB `overview` | "Sem descrição disponível" |
| Gêneros | TMDB `genres` | ocultar se vazio |
| Rating | TMDB `vote_average` (0-10) | ocultar se vazio |
| Trailer | TMDB `videos` type "Trailer" | ocultar se ausente |
| Poster/Backdrop | TMDB `poster_path`/`backdrop_path` | `tvg-logo` (blur para backdrop) |
| Grupo | `group.displayName` | |
| Progresso | `watchProgress` | Mostrar "Continuar do min XX:YY" se >5%. |

### 5.3 Ações
- **Assistir**: inicia player com URL do item. Se houver progresso salvo, oferecer opção "Retomar" vs "Recomeçar".
- **Favoritar**: toggle em `favorites`.
- **Trailer**: abrir modal/lightbox opcional (HLS YouTube/TMDB) se existir.
- **Escolher Áudio/Legendas**: atalho para seletores do player (botões vermelho/verde).

---

## 6. Integração TMDB

### 6.1 Estratégia
- Busca **on-demand** ao abrir detalhes (não bloquear render inicial).
- Cache local:
  - Busca por título: TTL 7 dias.
  - Detalhes: TTL 30 dias.
- Idioma: `pt-BR`.
- Normalização de título antes da busca (reutilizar `titleNormalizer` do PRD Master).

### 6.2 Fluxo
```
Abrir detalhes
  ↓ (async)
Buscar em cache pelo título normalizado
  ↓
Se cache hit → render TMDB
Se miss → chamar /search/movie → pegar first result → /movie/{id}?append_to_response=credits,videos
  ↓
Persistir em cache e atualizar UI
  ↓
Fallback para dados do M3U se erro/timeouts
```

### 6.3 Requisitos Técnicos
- Timeout 5s, 3 tentativas com backoff.
- Não bloquear ação Assistir se TMDB falhar.
- Placeholder se imagens indisponíveis.
- Exibir atribuição TMDB na tela "Sobre" (já no PRD Master).

---

## 7. Persistência e Estado

| Dado | Tabela/Store | Observações |
|------|--------------|-------------|
| Itens de filmes | IndexedDB `items` | Query: `where('mediaKind').equals('movie')` + `playlistId`. |
| Grupos de filmes | IndexedDB `groups` | `mediaKind = 'movie'`. |
| Favoritos | IndexedDB `favorites` | Chave `[playlistId+itemId]`. |
| Progresso | IndexedDB `watchProgress` | Atualizar ao sair do player ou a cada 30s. |
| Seleção de filtros | `homeStore`/`playlistStore` | Persistir em localStorage. |

### 7.1 Query Helpers (sugestão)
```typescript
// Carregar filmes da playlist ativa
db.items
  .where(['playlistId', 'mediaKind'])
  .equals([playlistId, 'movie'])
  .offset(page * PAGE_SIZE)
  .limit(PAGE_SIZE);

// Ordenar por rating TMDB (cacheado no item)
// Armazenar `tmdbRating` ao enriquecer para evitar ordenar em memória pesada.
```

---

## 8. Navegação D-PAD

| Tecla | Lista/Grade | Detalhes | Player (referência PRD_Player) |
|-------|-------------|----------|--------------------------------|
| LEFT/RIGHT | Move entre cards | Foca botões (Assistir/Favoritar/Trailer) | Seek -10/+10 |
| UP/DOWN | Scroll vertical (virtualizado) | Sobe/Desce em botões | Mostrar controles |
| ENTER/OK | Abrir detalhes / Assistir se já focado | Executa ação focada | Play/Pause |
| BACK | Volta para Home/Última tela | Volta para lista | Sai ou fecha overlays |
| RED (403) | Favoritar card/filme | Toggle favorito | Abre seletor de áudio |
| GREEN (404) | Abrir filtros rápidos | Abrir trailer (se existir) | Abre seletor de legendas |

---

## 9. Performance e Otimizações

| Item | Estratégia |
|------|------------|
| Virtualização | `@tanstack/react-virtual` para grade grande. |
| Lazy load de imagens | `loading="lazy"` + placeholder gradient. |
| Debounce de filtros | 200ms para buscas/ordenar locais. |
| Cache TMDB | TTL + fallback imediato ao M3U. |
| Memoização | Memorizar listas filtradas por playlistId+filtros. |
| Evitar re-render | Separar cartões em memo components com `focused` como única prop dinâmica. |

---

## 10. Estados Vazios e Erros

| Cenário | Mensagem/Ação |
|---------|---------------|
| Sem filmes na playlist | "Nenhum filme encontrado nesta playlist." Botão "Trocar playlist" e "Adicionar playlist". |
| TMDB falhou | Mostrar dados básicos do M3U; badge "Metadados indisponíveis" discreto. |
| Imagem quebrada | Placeholder com ícone 🎬 e cor do tema. |
| Limite de playlists | Mensagem do PRD_Onboarding (`LIMIT_REACHED`). |

---

## 11. Telemetria (opcional futuro)
- Tempo para abrir detalhes (meta < 500ms pós-cache).
- Taxa de sucesso TMDB (hit/miss).
- Tempo de start do player (meta 1-3s).
- Ações de filtro/ordenar utilizadas.

---

## 12. Checklist de Implementação
- [ ] Criar rota `/category/movie` reutilizando estrutura do PRD_Home.
- [ ] Implementar hook `useMoviesData(playlistId, filters)` com paginação/virtualização.
- [ ] Implementar grade de cards 2:3 com barra de progresso e badges de áudio/legenda.
- [ ] Implementar filtros (Todos/Favoritos/Continue Watching/Grupo/Ordenação).
- [ ] Implementar tela de detalhes com integração TMDB + fallback M3U.
- [ ] Acionar player com retomada (se `progress > 5%`).
- [ ] Toggle favorito via tecla vermelha e botão na UI.
- [ ] Garantir atualização de `watchProgress` ao sair do player (PRD_Player).
- [ ] Tratar estados vazios/erros e placeholders de imagem.
- [ ] Respeitar identidade visual (cores/tipografia PRD Master) e dark mode.

---

## 13. Dependências
- Usa dependências já listadas em PRD_Dependencies (não há bibliotecas novas obrigatórias).
- Opcional: `@tanstack/react-virtual` já recomendado no PRD_Home.

---

> **Autor**: Gerado com auxílio de IA para AtivePlay  
> **Última atualização**: 2025-11-26  
> **Compatibilidade**: Tizen 4.0+, webOS 5.0+ (target ES2015, plugin legacy ativo)
