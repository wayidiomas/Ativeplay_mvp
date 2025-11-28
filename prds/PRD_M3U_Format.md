# PRD: Entendimento do Formato M3U/M3U8

> **PRD ID**: PRD_M3U_Format
> **Versão**: 1.0
> **Referência**: PRD Master AtivePlay
> **Status**: Análise Inicial

---

## 1. Objetivo

Documentar a estrutura do formato M3U/M3U8 utilizado em playlists IPTV, identificando quais dados estão disponíveis para o AtivePlay extrair e exibir na interface.

---

## 2. Estrutura do Arquivo M3U

### 2.1 Header
```
#EXTM3U
#EXT-X-SESSION-DATA:DATA-ID="com.xui.1_5_5r2"
```

- `#EXTM3U` - Identificador obrigatório do formato M3U
- `#EXT-X-SESSION-DATA` - Metadados opcionais da sessão/provedor

### 2.2 Entrada de Item
Cada item da playlist segue o padrão:

```
#EXTINF:-1 xui-id=OPBX tvg-id="" tvg-name="Nome do Conteúdo" tvg-logo="https://url-da-imagem.png" group-title="CATEGORIA",Título Exibição
http://servidor.com:porta/play/hash.ts
```

**Estrutura em duas linhas:**
1. **Linha de metadados** (`#EXTINF`) - contém todos os atributos
2. **Linha de URL** - link direto para o stream

---

## 3. Campos Disponíveis no M3U

### 3.1 Campos Extraíveis

| Campo | Atributo M3U | Descrição | Uso no AtivePlay |
|-------|--------------|-----------|------------------|
| **Thumbnail** | `tvg-logo` | URL da imagem de capa | Card do catálogo, detalhes |
| **Título** | `tvg-name` | Nome do conteúdo | Exibição principal |
| **Título Alternativo** | Após vírgula | Nome de exibição | Fallback para título |
| **Categoria** | `group-title` | Grupo/categoria | Organização em seções |
| **ID EPG** | `tvg-id` | Identificador para guia de programação | EPG em canais ao vivo |
| **ID Provedor** | `xui-id` | Identificador do provedor | Interno/debug |
| **URL Stream** | Linha seguinte | Link de reprodução | Player |
| **Duração** | Valor após `#EXTINF:` | Duração em segundos (-1 = indefinido/live) | Indicador de tipo |

### 3.2 Campos NÃO Disponíveis Diretamente

| Campo | Disponibilidade | Solução Possível |
|-------|-----------------|------------------|
| **Ano de Lançamento** | ❌ Não disponível | Extrair do título via regex ou API TMDB |
| **Sinopse/Descrição** | ❌ Não disponível | API TMDB usando título |
| **Classificação/Rating** | ❌ Não disponível | API TMDB |
| **Elenco** | ❌ Não disponível | API TMDB |
| **Gênero** | ⚠️ Parcial (via group-title) | Mapeamento de categorias |
| **Temporada/Episódio** | ⚠️ Parcial (no título) | Parsing via regex |

---

## 4. Categorias Identificadas (group-title)

### 4.1 Conteúdo On-Demand (VOD)
| Categoria | Tipo | Observação |
|-----------|------|------------|
| `CINE FILMES HD 24HRS` | Filmes | Canais 24h de filme |
| `CINE SERIES HD 24HRS` | Séries | Canais 24h de série |
| `CINE DESENHOS HD 24HRS` | Animação | Infantil/Animação |
| `CINE NOVELAS HD 24HRS` | Novelas | Conteúdo brasileiro |
| `CINE ESPECIAL HD 24HRS` | Especial | Mix de conteúdos |

### 4.2 Canais ao Vivo (Live TV)
| Categoria | Exemplos |
|-----------|----------|
| `CANAIS ABERTOS FHD` | Globo, SBT, Record, Band |
| `CANAIS ABERTOS HD` | Versões HD dos canais abertos |
| `ESPORTES FHD` | ESPN, SporTV, Fox Sports |
| `FILMES FHD` | HBO, Telecine, Megapix |
| `VARIEDADES FHD` | Discovery, History, NatGeo |
| `INFANTIL FHD` | Cartoon, Disney, Nick |
| `NOTÍCIAS FHD` | GloboNews, CNN, BandNews |

---

## 5. Padrões de Título

### 5.1 Filmes
```
CINE ACAO 01
CINE COMEDIA 02
CINE TERROR 01
```
- Padrão: `CINE [GENERO] [NUMERO]`
- O número indica canal diferente com mesmo gênero

### 5.2 Séries (Canais 24h)
```
CINE FRIENDS 01
CINE THE OFFICE 01
CINE BREAKING BAD 01
```
- Padrão: `CINE [NOME_SERIE] [NUMERO]`

### 5.3 Canais ao Vivo
```
GLOBO FHD
ESPN FHD
HBO FHD
RECORD HD
```
- Padrão: `[NOME_CANAL] [QUALIDADE]`
- Qualidades: FHD (Full HD), HD, SD

---

## 6. Fontes de Thumbnail

### 6.1 Hospedagens Identificadas

| Domínio | Tipo | Confiabilidade |
|---------|------|----------------|
| `i.ibb.co` | ImgBB (hosting genérico) | ⚠️ Média |
| `image.tmdb.org` | The Movie Database | ✅ Alta |
| `themoviedb.org` | The Movie Database | ✅ Alta |
| URLs do provedor | Servidor IPTV | ⚠️ Variável |

### 6.2 Considerações
- Thumbnails podem quebrar (URLs expiradas)
- Implementar fallback para imagem padrão
- Cache local das imagens mais acessadas

---

## 7. Detecção de Tipo de Conteúdo

### 7.1 Algoritmo de Classificação

```typescript
function detectContentType(entry: M3UEntry): ContentType {
  const duration = entry.duration;
  const groupTitle = entry.groupTitle.toLowerCase();
  const tvgId = entry.tvgId;

  // Live TV: duração -1 e tem tvg-id para EPG
  if (duration === -1 && tvgId) {
    return 'LIVE_TV';
  }

  // Por categoria
  if (groupTitle.includes('filmes')) return 'MOVIE';
  if (groupTitle.includes('series')) return 'SERIES';
  if (groupTitle.includes('desenhos')) return 'ANIMATION';
  if (groupTitle.includes('novelas')) return 'SOAP_OPERA';
  if (groupTitle.includes('canais')) return 'LIVE_TV';
  if (groupTitle.includes('esportes')) return 'LIVE_TV';

  // Fallback: analisar título
  return analyzeTitle(entry.tvgName);
}
```

### 7.2 Categorias do App

| Tipo Interno | Exibição | Origem |
|--------------|----------|--------|
| `LIVE_TV` | TV ao Vivo | Canais com EPG |
| `MOVIE` | Filmes | group-title com "filmes" |
| `SERIES` | Séries | group-title com "series" |
| `ANIMATION` | Infantil | group-title com "desenhos" |
| `SOAP_OPERA` | Novelas | group-title com "novelas" |
| `SPECIAL` | Especial | Fallback |

---

## 8. Extração de Metadados Adicionais

### 8.1 Parsing do Título para Séries
```typescript
// Extrair temporada e episódio do título
// Ex: "Breaking Bad S01E05" ou "Breaking Bad 1x05"
const seriesRegex = /(.+?)\s*[Ss]?(\d{1,2})[xXeE]?(\d{1,2})/;

function parseSeriesTitle(title: string) {
  const match = title.match(seriesRegex);
  if (match) {
    return {
      seriesName: match[1].trim(),
      season: parseInt(match[2]),
      episode: parseInt(match[3])
    };
  }
  return null;
}
```

### 8.2 Extração de Ano
```typescript
// Alguns títulos podem ter ano
// Ex: "Inception (2010)" ou "Inception 2010"
const yearRegex = /\(?(\d{4})\)?$/;

function extractYear(title: string): number | null {
  const match = title.match(yearRegex);
  return match ? parseInt(match[1]) : null;
}
```

---

## 9. Formato de URL de Stream

### 9.1 Padrões Identificados

```
http://servidor.com:porta/play/HASH.ts
http://servidor.com:porta/live/usuario/senha/CANAL_ID.ts
http://servidor.com:porta/movie/usuario/senha/FILME_ID.mp4
http://servidor.com:porta/series/usuario/senha/EPISODIO_ID.mp4
```

### 9.2 Extensões de Stream

| Extensão | Tipo | Tratamento |
|----------|------|------------|
| `.ts` | Transport Stream | Direto no player |
| `.mp4` | MP4 | Direto no player |
| `.m3u8` | HLS Manifest | Requer parsing adicional |

---

## 10. Dados para Exibição no AtivePlay

### 10.1 Card do Catálogo
```typescript
interface CatalogCard {
  thumbnail: string;    // tvg-logo
  title: string;        // tvg-name ou título após vírgula
  category: string;     // group-title (processado)
  quality?: string;     // Extraído do título (FHD, HD, SD)
}
```

### 10.2 Tela de Detalhes
```typescript
interface ContentDetails {
  // Dados do M3U
  thumbnail: string;
  title: string;
  category: string;
  streamUrl: string;

  // Dados extraídos/processados
  year?: number;          // Regex do título
  quality?: string;       // Regex do título
  season?: number;        // Para séries
  episode?: number;       // Para séries

  // Dados externos (TMDB - futuro)
  description?: string;
  rating?: number;
  cast?: string[];
  genres?: string[];
}
```

---

## 11. Limitações e Considerações

### 11.1 Limitações do Formato M3U
1. **Sem metadados ricos** - Apenas thumbnail e título básico
2. **Categorização inconsistente** - Depende do provedor
3. **URLs temporárias** - Alguns provedores expiram links
4. **Qualidade de thumbnails** - Variável, pode estar quebrada

### 11.2 Recomendações
1. Implementar fallback para imagens quebradas
2. Normalizar categorias do provedor para categorias internas
3. Considerar integração futura com TMDB para metadados ricos
4. Cache agressivo do catálogo parseado

---

## 12. Próximos Passos

1. Implementar parser M3U no módulo `src/core/parser/`
2. Criar tipos TypeScript para estrutura de dados
3. Implementar normalização de categorias
4. Criar sistema de cache para catálogo
5. Definir fallbacks visuais para dados ausentes

---

## 13. Referências

- [M3U Wikipedia](https://en.wikipedia.org/wiki/M3U)
- [EXTINF Specification](https://datatracker.ietf.org/doc/html/rfc8216)
- [iptv-playlist-parser](https://github.com/freearhey/iptv-playlist-parser)
- [TMDB API](https://developers.themoviedb.org/3)

---

> **Nota**: Este PRD documenta o formato padrão encontrado no exemplo analisado. Outros provedores podem ter variações nos campos e estrutura.
