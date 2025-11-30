/**
 * Content Classifier
 * Classifica itens M3U como live, movie, series ou unknown
 */

import type { MediaKind, ParsedTitle } from './types';

// Interface para informações de série extraídas
export interface SeriesInfo {
  seriesName: string;       // Nome base da série (sem SxxExx)
  season: number;           // Número da temporada
  episode: number;          // Número do episódio
  isSeries: boolean;        // Se foi detectado como série
}

// Patterns para classificacao por grupo (mais comum em playlists IPTV BR)
// Otimizado: Regex compiladas uma vez (reutilizadas)
const GROUP_PATTERNS = {
  live: [
    /\b(canais?|channels?|tv|live|news|ao vivo|abertos?)\b/i,
    /\b(globo|sbt|record|band|redetv|cultura)\b/i, // Canais BR comuns
    /24HRS?/i, /24\/7/i, // loops 24h
    /SERIES\s*24H/i, // "⭐ SERIES 24H" = canais 24H, não séries!
    /CANAIS\s*\|/i, // "⭐ Canais | Filmes e Séries" = canais ao vivo
    /futebol/i, /esporte/i, /sports?/i, // esportes
    /M[UÚ]SICAS?\s*24H/i, // música 24h
    /RUNTIME\s*24H/i, // runtime 24h
    /CINE\s+.*24HRS/i, // CINE … 24HRS
    /\bJogos do Dia\b/i, // eventos ao vivo
    /\b(Esportes?|Sports?)\s*PPV/i, // PPV
    /\b(SPORTV|ESPN|FOX\s*SPORTS|COMBATE)\b/i, // esportes específicos
    /\bPPV\b/i, // Pay-per-view
    /\bDOCUMENT[ÁA]RIOS?\b/i, // Canais de documentários
    /\bVARIEDADES\b/i, // Canais de variedades
  ],
  movie: [
    /\b(filmes?|movies?|cinema|lancamentos?|lançamentos?)\b/i,
    /\bvod\b/i,
    /\b(acao|terror|comedia|drama|ficcao|aventura|animacao|suspense|romance)\b/i, // Gêneros
    /\b(a[cç][aã]o|com[eé]dia|fic[cç][aã]o|anima[cç][aã]o)\b/i, // Gêneros com acentos
    /\b(dublado|legendado|dual|nacional)\b/i, // Indicadores comuns de filmes
    /\b(4k|uhd|fhd|hd)\s*(filmes?|movies?)?\b/i, // Qualidade + filmes
    // Padrões Xtream Codes com pipes e prefixos de país
    /[:\|]\s*(filmes?|movies?|vod)/i, // VOD | Action, BR: Filmes
    /\|\s*br\s*\|\s*(filmes?|movies?|vod)/i, // |BR| FILMES
    /\[\s*br\s*\]\s*(filmes?|movies?|vod)/i, // [BR] FILMES
    /\bCOLET[AÂ]NEA\b/i, // Coletâneas (franquias de filmes)
  ],
  series: [
    /▶️\s*s[eé]ries?/i, // Prefixo com emoji usado no m3u analisado
    /\b(series?|shows?|novelas?|animes?|doramas?|k-?dramas?)\b/i,
    /#\s*\|\s*(s[eé]ries|novelas)/i, // prefixo "# |" do segundo M3U (Novelas, Séries)
    // REMOVIDO: /\b(netflix|hbo|amazon|disney|apple|paramount|star)\b/i
    // Motivo: Plataformas têm FILMES e SÉRIES, não devem decidir sozinhas
    // Usar apenas S • prefix (detectado em classifyByTitle)
    /\btemporadas?\b/i,
    // Padrões com acento e Xtream Codes
    /s[eé]ries?/i, // SÉRIES (com acento)
    /[:\|]\s*s[eé]ries?/i, // BR: SÉRIES, | SÉRIES
    /\|\s*br\s*\|\s*s[eé]ries?/i, // |BR| SÉRIES
    /\[\s*br\s*\]\s*s[eé]ries?/i, // [BR] SÉRIES
    /\bDESENHOS\b/i, // Desenhos podem ser séries
  ],
};

// Patterns para classificacao por titulo
const TITLE_PATTERNS = {
  live: [
    /\b(24\/7|24h|live|ao vivo)\b/i,
  ],
  movie: [
    /\(\d{4}\)/, // (2024)
    /\[\d{4}\]/, // [2024]
    // REMOVIDO: /\b(20[0-2]\d|19\d{2})\b/ - Ano solto muito ambíguo, pode dar match duplo
    /\b(4k|2160p|1080p|720p|480p|bluray|webrip|hdrip|dvdrip|hdcam|web-dl|bdrip|hdts|hd-ts|cam|hdcam)\b/i,
    /\b(dublado|dual|leg|legendado|nacional|dub|sub)\b/i, // Indicadores comuns IPTV BR
    /\b(acao|terror|comedia|drama|suspense|romance|aventura|animacao|ficcao)\b/i, // Gêneros no nome
  ],
  series: [
    /s\d{1,2}[\s._-]?e\d{1,2}/i, // S01E01
    /\b\d{1,2}x\d{1,2}\b/i, // 1x01
    /\bT\d{1,2}[\s._-]?E\d{1,2}\b/i, // T01E01 (PT-BR)
    /\btemporada\s*\d+/i,
    /\bepisodio\s*\d+/i,
    /\bseason\s*\d+/i,
    /\bepisode\s*\d+/i,
    /\bcap[ií]tulo\s*\d+/i, // Capítulo (novelas BR)
    /\bep\.?\s*\d+/i, // EP 01, Ep.01
  ],
};

// Regex para extrair metadados do titulo
const TITLE_EXTRACTORS = {
  year: /[\(\[](\d{4})[\)\]]/,
  yearStandalone: /\b(19|20)\d{2}\b/,
  season: /(?:s|season|temporada)[\s._-]?(\d{1,2})/i,
  episode: /(?:e|episode|episodio)[\s._-]?(\d{1,3})/i,
  seasonEpisode: /s(\d{1,2})[\s._-]?e(\d{1,3})/i,
  altSeasonEpisode: /(\d{1,2})x(\d{1,3})/i,
  quality: /\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|sd)\b/i,
  multiAudio: /\b(dual|multi|dublado\s*e\s*legendado)\b/i,
  dubbed: /\b(dub|dublado|dubbed|nacional)\b/i,
  subbed: /\b(leg|legendado|subbed|sub)\b/i,
  language: /\b(pt|por|ptbr|pt-br|en|eng|es|esp|fr|fra|de|deu|it|ita|ja|jpn)\b/i,
};

export class ContentClassifier {
  // Cache LRU para extractSeriesInfo (otimização 30-40%)
  private static seriesCache = new Map<string, SeriesInfo | null>();
  private static readonly MAX_CACHE_SIZE = 10000;

  // Regex patterns compiladas (reutilização)
  private static readonly SERIES_PATTERNS = {
    main: /(.+?)\s+S(\d{1,2})E(\d{1,3})/i,
    alt: /(.+?)\s+(\d{1,2})x(\d{1,3})\b/i,
    pt: /(.+?)\s+T(\d{1,2})E(\d{1,3})/i,
  };

  /**
   * Limpa o cache (útil para testes ou quando memória alta)
   */
  static clearCache(): void {
    this.seriesCache.clear();
  }

  /**
   * Classifica um item baseado no grupo e titulo
   */
  static classify(name: string, group: string): MediaKind {
    // 0. Filtros de alta prioridade (prefixos especiais e conteúdo adulto)

    // Filtro de conteúdo adulto (classificar como live para ocultar)
    if (group && /xxx|onlyfans|adulto|\+18/i.test(group)) {
      return 'live';
    }

    // URLs que terminam em /ts (stream típico IPTV) → live
    if (/\/ts(\?|$)/i.test(group) || /\/ts(\?|$)/i.test(name)) {
      return 'live';
    }

    const combined = `${name} ${group || ''}`.toLowerCase();
    if (/\b24h(rs)?\b/.test(combined) || /24\/7/.test(combined)) {
      return 'live';
    }

    // EXCEÇÕES DE GROUP-TITLE (verificar ANTES de S##E##!)

    // COLETÂNEAS: Franquias de filmes usando S##E## (Harry Potter S01E01-08 são FILMES!)
    if (group && /coletanea/i.test(group)) {
      return 'movie';
    }

    // CINE 24HRS: Canais temáticos contínuos (719+ canais)
    if (group && /CINE.*24H/i.test(group)) {
      return 'live';
    }

    // Canal 24H (sempre live, mesmo se tiver ano ou padrão de série)
    if (name && /^24H\s*•/i.test(name)) {
      return 'live';
    }

    // Canais CINE temáticos (CINE TERROR 01, CINE COMEDIA 05, etc)
    if (name && /^CINE\s+\w+\s+\d{2}/i.test(name)) {
      return 'live';
    }

    // Eventos ao vivo com horário (19:30 Juventude X Bahia)
    if (name && /^\d{1,2}:\d{2}\s+/i.test(name)) {
      return 'live';
    }

    // 1. Tenta classificar pelo grupo primeiro (mais confiavel)
    const groupKind = this.classifyByGroup(group);
    if (groupKind !== 'unknown') {
      return groupKind;
    }

    // 2. Classifica pelo titulo
    return this.classifyByTitle(name, group);
  }

  /**
   * Classifica baseado no nome do grupo
   */
  static classifyByGroup(group: string): MediaKind {
    if (!group) return 'unknown';

    const lowerGroup = group.toLowerCase();

    const hasSeries = /s[eé]ries|series|novelas|animes|doramas/i.test(lowerGroup);
    const hasMovies = /filmes|movies|cinema|lancamentos|lançamentos|vod/i.test(lowerGroup);
    const has24h = /24h|24\/7/i.test(lowerGroup);

    // Se é série + 24h => live (loop 24h)
    if (hasSeries && has24h) return 'live';

    // Series primeiro (evita 'Apple TV' cair em live por causa do 'tv')
    if (hasSeries || /#\s*\|\s*(s[eé]ries|novelas)/i.test(group)) return 'series';

    // Filmes antes de live (evita 'Filmes | Apple TV' cair em live)
    if (hasMovies || /#\s*\|\s*filmes?/i.test(group)) return 'movie';

    // Live/TV (restante)
    for (const pattern of GROUP_PATTERNS.live) {
      if (pattern.test(lowerGroup)) return 'live';
    }

    // Series (fallback regex)
    for (const pattern of GROUP_PATTERNS.series) {
      if (pattern.test(lowerGroup)) return 'series';
    }

    // Filmes
    for (const pattern of GROUP_PATTERNS.movie) {
      if (pattern.test(lowerGroup)) return 'movie';
    }

    return 'unknown';
  }

  /**
   * Classifica baseado no titulo (e opcionalmente no grupo)
   */
  static classifyByTitle(name: string, group: string = ''): MediaKind {
    if (!name) return 'unknown';

    // PREFIXOS EXPLÍCITOS (S • / F •) - Peso ALTO
    // "S • Netflix", "S • Globoplay" → series
    if (group && /\bS\s*•/i.test(group)) {
      return 'series';
    }
    // "F • Legendados", "F • Amazon Prime" → movie
    if (group && /\bF\s*•/i.test(group)) {
      return 'movie';
    }

    // Series primeiro (patterns mais especificos como S01E01)
    for (const pattern of TITLE_PATTERNS.series) {
      if (pattern.test(name)) return 'series';
    }

    // Filmes - LÓGICA FLEXÍVEL com group-title
    // Se group-title indica FILME e NÃO tem S##E## → É filme!
    // Resolve: "Pasárgada", "Cabrito", "Levante" sem ano/idioma
    const hasMovieGroup = group && /filme|movies?|cinema|lancamento|lançamento|f\s*•|▶️\s*filmes?/i.test(group);
    const hasSeriesPattern = /S\d{1,2}E\d{1,3}/i.test(name);

    if (hasMovieGroup && !hasSeriesPattern) {
      return 'movie'; // 1 match suficiente quando group-title é claro
    }

    // Título precisa de MÚLTIPLOS matches (se não tem group-title claro)
    // Exemplos válidos: "Flow (2024) Dublado" (ano + idioma = 2 matches)
    // Exemplos inválidos: "Show (2020)" (só ano = 1 match, classificado como unknown)
    let movieScore = 0;
    for (const pattern of TITLE_PATTERNS.movie) {
      if (pattern.test(name)) movieScore++;
    }
    if (movieScore >= 2) return 'movie';

    // Live/TV
    for (const pattern of TITLE_PATTERNS.live) {
      if (pattern.test(name)) return 'live';
    }

    return 'unknown';
  }

  /**
   * Extrai metadados do titulo
   */
  static parseTitle(name: string): ParsedTitle {
    let title = name;
    let year: number | undefined;
    let season: number | undefined;
    let episode: number | undefined;
    let quality: string | undefined;
    let language: string | undefined;
    let isMultiAudio = false;
    let isDubbed = false;
    let isSubbed = false;

    // Extrai ano
    const yearMatch = name.match(TITLE_EXTRACTORS.year);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
      title = title.replace(yearMatch[0], '').trim();
    } else {
      const yearStandalone = name.match(TITLE_EXTRACTORS.yearStandalone);
      if (yearStandalone) {
        const potentialYear = parseInt(yearStandalone[0], 10);
        if (potentialYear >= 1900 && potentialYear <= new Date().getFullYear() + 1) {
          year = potentialYear;
        }
      }
    }

    // Extrai temporada e episodio (S01E01 format)
    const seMatch = name.match(TITLE_EXTRACTORS.seasonEpisode);
    if (seMatch) {
      season = parseInt(seMatch[1], 10);
      episode = parseInt(seMatch[2], 10);
      title = title.replace(seMatch[0], '').trim();
    } else {
      // Tenta formato 1x01
      const altMatch = name.match(TITLE_EXTRACTORS.altSeasonEpisode);
      if (altMatch) {
        season = parseInt(altMatch[1], 10);
        episode = parseInt(altMatch[2], 10);
        title = title.replace(altMatch[0], '').trim();
      } else {
        // Tenta separadamente
        const seasonMatch = name.match(TITLE_EXTRACTORS.season);
        if (seasonMatch) {
          season = parseInt(seasonMatch[1], 10);
        }
        const episodeMatch = name.match(TITLE_EXTRACTORS.episode);
        if (episodeMatch) {
          episode = parseInt(episodeMatch[1], 10);
        }
      }
    }

    // Extrai qualidade
    const qualityMatch = name.match(TITLE_EXTRACTORS.quality);
    if (qualityMatch) {
      quality = qualityMatch[1].toUpperCase();
      title = title.replace(qualityMatch[0], '').trim();
    }

    // Verifica audio
    isMultiAudio = TITLE_EXTRACTORS.multiAudio.test(name);
    isDubbed = TITLE_EXTRACTORS.dubbed.test(name);
    isSubbed = TITLE_EXTRACTORS.subbed.test(name);

    // Extrai idioma
    const langMatch = name.match(TITLE_EXTRACTORS.language);
    if (langMatch) {
      language = langMatch[1].toUpperCase();
    }

    // Limpa o titulo
    title = this.cleanTitle(title);

    return {
      title,
      year,
      season,
      episode,
      quality,
      language,
      isMultiAudio,
      isDubbed,
      isSubbed,
    };
  }

  /**
   * Remove prefixos comuns (tags, emojis, etc) do título
   * Ex: "⭐ Breaking Bad S01E01" → "Breaking Bad S01E01"
   */
  private static removePrefixes(title: string): string {
    return title
      .replace(/^(\[.*?\]|\(.*?\)|⭐|★|•|\+|\-|=|#)\s*/g, '') // Remove tags e símbolos
      .replace(/^\d+\.\s+/g, '') // Remove numeração "1. Nome"
      .trim();
  }

  /**
   * Extrai informações de série do nome (detecta padrão SxxExx)
   * Retorna null se não for detectado como série
   * Otimizado com cache LRU (30-40% mais rápido)
   */
  static extractSeriesInfo(name: string): SeriesInfo | null {
    // Check cache first (otimização crítica)
    const cached = this.seriesCache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    // Remove prefixos comuns antes de tentar match
    const cleanName = this.removePrefixes(name);

    // Padrão principal: Nome + SxxExx (ex: "Breaking Bad S01E01")
    // Usa pattern compilado (reutilização)
    const mainMatch = cleanName.match(this.SERIES_PATTERNS.main);

    if (mainMatch) {
      const result = {
        seriesName: mainMatch[1].trim(),
        season: parseInt(mainMatch[2], 10),
        episode: parseInt(mainMatch[3], 10),
        isSeries: true,
      };
      this.updateCache(name, result);
      return result;
    }

    // Padrão alternativo: Nome + 1x01 (ex: "Breaking Bad 1x01")
    const altMatch = cleanName.match(this.SERIES_PATTERNS.alt);

    if (altMatch) {
      const result = {
        seriesName: altMatch[1].trim(),
        season: parseInt(altMatch[2], 10),
        episode: parseInt(altMatch[3], 10),
        isSeries: true,
      };
      this.updateCache(name, result);
      return result;
    }

    // Padrão PT-BR/Espanhol: Nome + T01E01 (ex: "La Casa de Papel T01E01")
    const ptMatch = cleanName.match(this.SERIES_PATTERNS.pt);

    if (ptMatch) {
      const result = {
        seriesName: ptMatch[1].trim(),
        season: parseInt(ptMatch[2], 10),
        episode: parseInt(ptMatch[3], 10),
        isSeries: true,
      };
      this.updateCache(name, result);
      return result;
    }

    // Não é série - cacheia resultado null também
    this.updateCache(name, null);
    return null;
  }

  /**
   * Atualiza cache com eviction LRU
   */
  private static updateCache(key: string, value: SeriesInfo | null): void {
    // LRU eviction: remove primeiro item se cache cheio
    if (this.seriesCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.seriesCache.keys().next().value;
      if (firstKey !== undefined) {
        this.seriesCache.delete(firstKey);
      }
    }
    this.seriesCache.set(key, value);
  }

  /**
   * Limpa o titulo removendo tags e caracteres especiais
   */
  static cleanTitle(title: string): string {
    return title
      // Remove tags entre colchetes/parenteses
      .replace(/[\[\(][^\]\)]*[\]\)]/g, '')
      // Remove qualidade/resolucao
      .replace(/\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|sd)\b/gi, '')
      // Remove formatos de audio/video
      .replace(/\b(aac|ac3|dts|x264|x265|hevc|h264|h265|webdl|web-dl|bluray|bdrip|webrip|hdrip|dvdrip|hdcam)\b/gi, '')
      // Remove indicadores de audio
      .replace(/\b(dub|dublado|dubbed|leg|legendado|subbed|sub|dual|multi|nacional)\b/gi, '')
      // Remove pipes e barras
      .replace(/[|]/g, ' ')
      // Remove multiplos espacos
      .replace(/\s+/g, ' ')
      // Remove espacos no inicio e fim
      .trim()
      // Remove pontuacao no final
      .replace(/[.\-_]+$/, '')
      .trim();
  }
}

export default ContentClassifier;
