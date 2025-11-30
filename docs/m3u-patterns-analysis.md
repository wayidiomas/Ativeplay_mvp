# Análise de Padrões M3U - AtivePlay

## Estrutura do Arquivo M3U

Cada entrada no M3U segue o padrão:
```
#EXTINF:-1 [atributos] nome
http://url-do-stream
```

## Padrões Identificados

### 1. **LIVES (Canais ao Vivo)**

**Características:**
- Group-title contém palavras como: "ABERTOS", "SPORTV", "GLOBO", "BAND", "ESPORTES", "PPV", "DOCUMENTÁRIOS", "VARIEDADES"
- URLs geralmente apontam para streams contínuos (formato `.ts` no final)
- Não possuem indicação de temporada/episódio
- tvg-id geralmente preenchido (ex: `br#sportv-hd`, `AgroMais.br`)

**Exemplos:**
```
#EXTINF:-1 tvg-id="br#sportv-hd" tvg-name="SPORTV 1 FHD" tvg-logo="..." group-title="SPORTV"
#EXTINF:-1 tvg-id="AgroMais.br" tvg-name="AGROMAIS HD" tvg-logo="..." group-title="ABERTOS"
#EXTINF:-1 tvg-id="CanalBrasil.br" tvg-name="CANAL BRASIL FHD" tvg-logo="..." group-title="ABERTOS"
```

**Padrões de URL:**
- `http://servidor/play/usuario/senha/.../ts`
- Geralmente streams ao vivo

---

### 2. **FILMES**

**Características:**
- Group-title contém: "FILMES", "CINE", categorias como "AÇÃO", "COMÉDIA", "TERROR", "DRAMA", "LEGENDADOS", "4K", "NACIONAIS"
- Nome não contém padrão S##E##
- URLs apontam para arquivos de vídeo únicos
- Pode conter indicadores: `[L]` para legendado, `[4K]` para qualidade

**Exemplos:**
```
#EXTINF:-1 tvg-name="CINE CATASTROFE 01" tvg-logo="..." group-title="CINE FILMES HD 24HRS"
#EXTINF:-1 tvg-name="O Homem do Saco (2024) [4K]" tvg-logo="..." group-title="4K"
#EXTINF:-1 tvg-name="Casamento Grego 2 (2016)" tvg-logo="..." group-title="COMÉDIA"
#EXTINF:-1 tvg-name="Breakup Season (2024) [L]" tvg-logo="..." group-title="LEGENDADOS"
```

**Subcategorias de Filmes:**
- Canais 24h de filmes: "CINE FILMES HD 24HRS"
- Por gênero: "AÇÃO | CRIME | GUERRA", "COMÉDIA", "TERROR", "DRAMA", "FANTASIA"
- Por qualidade: "4K", "HD", "FHD"
- Por idioma: "LEGENDADOS", "NACIONAIS"

**Padrões de URL:**
- Geralmente arquivos `.mp4` ou similar
- Path pode conter `/movie/` ou `/vod/`

---

### 3. **SÉRIES**

**Características:**
- **PADRÃO PRINCIPAL:** Nome contém `S##E##` (ex: S01E01, S02E15)
- Group-title contém: "Series", "SERIES", "CINE SERIES HD 24HRS"
- URLs apontam para episódios específicos (geralmente `.mp4`)
- Mesma série agrupa múltiplos episódios

**Exemplos:**
```
#EXTINF:-1 tvg-name="Eu Tu E Ela S02E04" tvg-logo="..." group-title="Series | Amazon Prime Video"
#EXTINF:-1 tvg-name="Eu A Patroa E As Criancas S01E01" tvg-logo="..." group-title="Series | DirecTV"
#EXTINF:-1 tvg-name="DOIS HOMENS E MEIO 01" tvg-logo="..." group-title="CINE SERIES HD 24HRS"
```

**Variações de Formato:**
- Com S##E##: `"Eu Tu E Ela S02E04"`
- Sem padrão explícito mas sequencial: `"DOIS HOMENS E MEIO 01"`, `"DOIS HOMENS E MEIO 02"`
- Canais 24h de séries: `"24H • 911 (2018)"` no group-title "⭐ SERIES 24H"

**Subcategorias:**
- Por plataforma: "Series | Amazon Prime Video", "Series | DirecTV", "Series | Netflix"
- Canais 24h: "CINE SERIES HD 24HRS", "⭐ SERIES 24H"

**Padrões de URL:**
- Path contém `/series/`
- Formato `.mp4`
- Exemplo: `http://cdnp.xyz:80/series/199003005/760722007/3095927.mp4`

---

### 4. **CANAIS 24H Especiais**

**Características:**
- Prefixo "24H •" no nome
- Group-title contém: "24H", "DESENHOS 24H", "ANIME 24H", "DORAMAS 24H", "MÚSICAS 24H", "DISCOVERY PLUS 24H"
- São streams contínuos de conteúdo específico

**Exemplos:**
```
#EXTINF:-1 tvg-name="24H • 911 (2018)" group-title="⭐ SERIES 24H"
#EXTINF:-1 tvg-name="24H • Bob Esponja Calça Quadrada (1999)" group-title="⭐ DESENHOS 24H"
#EXTINF:-1 tvg-name="24H • Anime - Dragon Ball Z" group-title="⭐ Canais | ANIME 24H"
#EXTINF:-1 tvg-name="24H • Bruno e Marrone" group-title="⭐ MÚSICAS 24H"
```

---

## Regras de Classificação (Ordem de Prioridade)

### 1. **Identificar SÉRIE**
```
SE (nome contém padrão /S\d+E\d+/i OU group-title contém /series/i)
ENTÃO tipo = "series"
```

### 2. **Identificar CANAL 24H**
```
SE (nome começa com "24H •" OU group-title contém "24H")
ENTÃO tipo = "live_24h" (ou classificar como subcategoria específica)
```

### 3. **Identificar LIVE (Canal ao Vivo)**
```
SE (
  group-title contém /ABERTOS|SPORTV|GLOBO|BAND|ESPORTES|PPV|DOCUMENTÁRIOS|VARIEDADES|CANAIS/i
  OU tvg-id está preenchido com padrão de canal (contém ".br" ou "#")
  OU URL termina com /\.ts$/
)
ENTÃO tipo = "live"
```

### 4. **Identificar FILME**
```
SE (
  tipo != "series"
  E tipo != "live"
  E (
    group-title contém /FILMES|CINE|AÇÃO|COMÉDIA|TERROR|DRAMA|4K|LEGENDADOS|NACIONAIS|AVENTURA|FANTASIA/i
    OU URL contém /movie|vod/i
  )
)
ENTÃO tipo = "movie"
```

---

## Estrutura de Dados Sugerida para SQLite

### Tabela: `content`
```sql
CREATE TABLE content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,  -- 'movie', 'series', 'live', 'live_24h'
    name TEXT NOT NULL,
    group_title TEXT,
    tvg_id TEXT,
    tvg_logo TEXT,
    url TEXT NOT NULL,

    -- Campos específicos para séries
    series_name TEXT,     -- Nome base da série
    season INTEGER,       -- Número da temporada
    episode INTEGER,      -- Número do episódio

    -- Metadados
    quality TEXT,         -- HD, FHD, SD, 4K
    language TEXT,        -- Legendado, Nacional, etc

    -- Índices para busca rápida
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_type ON content(type);
CREATE INDEX idx_group_title ON content(group_title);
CREATE INDEX idx_series_name ON content(series_name);
CREATE INDEX idx_name ON content(name);
```

### Tabela: `series_metadata` (Opcional - para agrupamento)
```sql
CREATE TABLE series_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_name TEXT UNIQUE NOT NULL,
    total_seasons INTEGER,
    total_episodes INTEGER,
    logo TEXT,
    group_title TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Estratégia de Parsing Otimizada

### 1. **Parse Incremental com Regex**
```javascript
const patterns = {
    series: /S(\d+)E(\d+)/i,
    quality: /\b(4K|FHD|HD|SD)\b/i,
    language: /\[(L|Legendado|Nacional)\]/i,
};
```

### 2. **Classificação Hierárquica**
- Primeira passada: Identificar tipo (serie > live_24h > live > movie)
- Segunda passada: Extrair metadados específicos
- Terceira passada: Agrupar séries e criar metadata

### 3. **Normalização de Nomes**
```javascript
// Para séries, remover S##E## do nome para criar series_name
"Eu Tu E Ela S02E04" → series_name: "Eu Tu E Ela"

// Normalizar qualidade
"SPORTV 1 FHD" → quality: "FHD"
```

### 4. **Batch Insert com Transaction**
```javascript
// Usar transação SQLite para inserção em lote
db.transaction(() => {
    const stmt = db.prepare('INSERT INTO content VALUES (...)');

    for (const item of parsedItems) {
        stmt.run(item);
    }

    stmt.finalize();
});
```

### 5. **Índices para Performance**
- Criar índices em `type`, `group_title`, `series_name`
- Para busca: usar LIKE com índice ou FTS (Full-Text Search)

---

## Otimizações Específicas

### 1. **Cache de Regex**
Compilar regex uma vez e reutilizar

### 2. **Streaming Parse**
Para arquivos grandes (200MB+), parsear em chunks:
```javascript
const stream = fs.createReadStream(m3uPath, { encoding: 'utf8' });
let buffer = '';

stream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Guarda linha incompleta

    processLines(lines);
});
```

### 3. **Worker Threads**
Para arquivos muito grandes, usar worker threads para parsing paralelo

### 4. **Deduplicação**
Verificar URLs duplicadas antes de inserir

---

## Exemplos de Queries Otimizadas

```sql
-- Buscar todas as séries
SELECT DISTINCT series_name, COUNT(*) as episodes
FROM content
WHERE type = 'series'
GROUP BY series_name;

-- Buscar episódios de uma série
SELECT * FROM content
WHERE series_name = 'Eu Tu E Ela'
ORDER BY season, episode;

-- Buscar filmes por gênero
SELECT * FROM content
WHERE type = 'movie'
  AND group_title LIKE '%COMÉDIA%';

-- Buscar canais ao vivo HD
SELECT * FROM content
WHERE type = 'live'
  AND quality IN ('HD', 'FHD')
ORDER BY name;
```

---

## Conclusões

1. **Padrão S##E## é confiável** para identificar séries
2. **group-title é crucial** para classificação de tipo
3. **URL patterns** podem ajudar (`.ts` = live, `/series/` = série)
4. **Normalização** é essencial para buscas eficientes
5. **Índices apropriados** são críticos para performance com 200MB+ de dados
