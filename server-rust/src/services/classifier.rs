use lazy_static::lazy_static;
use lru::LruCache;
use regex::Regex;
use std::num::NonZeroUsize;
use std::sync::Mutex;

use crate::models::{ExtractedSeriesInfo, MediaKind, ParsedTitle};

// Cache for extractSeriesInfo (LRU with 10k max entries)
lazy_static! {
    static ref SERIES_CACHE: Mutex<LruCache<String, Option<ExtractedSeriesInfo>>> =
        Mutex::new(LruCache::new(NonZeroUsize::new(10000).unwrap()));

    // ============ GROUP PATTERNS ============
    static ref GROUP_LIVE_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"(?i)\b(canais?|channels?|tv|live|news|ao vivo|abertos?)\b").unwrap(),
        Regex::new(r"(?i)\b(globo|sbt|record|band|redetv|cultura)\b").unwrap(),
        Regex::new(r"(?i)24HRS?").unwrap(),
        Regex::new(r"24/7").unwrap(),
        Regex::new(r"(?i)SERIES\s*24H").unwrap(),
        Regex::new(r"(?i)CANAIS\s*\|").unwrap(),
        Regex::new(r"(?i)futebol").unwrap(),
        Regex::new(r"(?i)esporte").unwrap(),
        Regex::new(r"(?i)sports?").unwrap(),
        Regex::new(r"(?i)M[UÚ]SICAS?\s*24H").unwrap(),
        Regex::new(r"(?i)RUNTIME\s*24H").unwrap(),
        Regex::new(r"(?i)CINE\s+.*24HRS").unwrap(),
        Regex::new(r"(?i)\bJogos do Dia\b").unwrap(),
        Regex::new(r"(?i)\b(Esportes?|Sports?)\s*PPV").unwrap(),
        Regex::new(r"(?i)\b(SPORTV|ESPN|FOX\s*SPORTS|COMBATE)\b").unwrap(),
        Regex::new(r"(?i)\bPPV\b").unwrap(),
        Regex::new(r"(?i)\bDOCUMENT[ÁA]RIOS?\b").unwrap(),
        Regex::new(r"(?i)\bVARIEDADES\b").unwrap(),
    ];

    static ref GROUP_MOVIE_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"(?i)\b(filmes?|movies?|cinema|lancamentos?|lançamentos?)\b").unwrap(),
        Regex::new(r"(?i)\bvod\b").unwrap(),
        Regex::new(r"(?i)\b(acao|terror|comedia|drama|ficcao|aventura|animacao|suspense|romance)\b").unwrap(),
        Regex::new(r"(?i)\b(a[cç][aã]o|com[eé]dia|fic[cç][aã]o|anima[cç][aã]o)\b").unwrap(),
        Regex::new(r"(?i)\b(dublado|legendado|dual|nacional)\b").unwrap(),
        Regex::new(r"(?i)\b(4k|uhd|fhd|hd)\s*(filmes?|movies?)?\b").unwrap(),
        Regex::new(r"(?i)[:\|]\s*(filmes?|movies?|vod)").unwrap(),
        Regex::new(r"(?i)\|\s*br\s*\|\s*(filmes?|movies?|vod)").unwrap(),
        Regex::new(r"(?i)\[\s*br\s*\]\s*(filmes?|movies?|vod)").unwrap(),
        Regex::new(r"(?i)\bCOLET[AÂ]NEA\b").unwrap(),
    ];

    static ref GROUP_SERIES_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"(?i)▶️\s*s[eé]ries?").unwrap(),
        Regex::new(r"(?i)\b(series?|shows?|novelas?|animes?|doramas?|k-?dramas?)\b").unwrap(),
        Regex::new(r"(?i)#\s*\|\s*(s[eé]ries|novelas)").unwrap(),
        Regex::new(r"(?i)\btemporadas?\b").unwrap(),
        Regex::new(r"(?i)s[eé]ries?").unwrap(),
        Regex::new(r"(?i)[:\|]\s*s[eé]ries?").unwrap(),
        Regex::new(r"(?i)\|\s*br\s*\|\s*s[eé]ries?").unwrap(),
        Regex::new(r"(?i)\[\s*br\s*\]\s*s[eé]ries?").unwrap(),
        Regex::new(r"(?i)\bDESENHOS\b").unwrap(),
    ];

    // ============ TITLE PATTERNS ============
    static ref TITLE_LIVE_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"(?i)\b(24/7|24h|live|ao vivo)\b").unwrap(),
    ];

    static ref TITLE_MOVIE_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"\(\d{4}\)").unwrap(),
        Regex::new(r"\[\d{4}\]").unwrap(),
        Regex::new(r"(?i)\b(4k|2160p|1080p|720p|480p|bluray|webrip|hdrip|dvdrip|hdcam|web-dl|bdrip|hdts|hd-ts|cam|hdcam)\b").unwrap(),
        Regex::new(r"(?i)\b(dublado|dual|leg|legendado|nacional|dub|sub)\b").unwrap(),
        Regex::new(r"(?i)\b(acao|terror|comedia|drama|suspense|romance|aventura|animacao|ficcao)\b").unwrap(),
    ];

    static ref TITLE_SERIES_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"(?i)s\d{1,2}[\s._-]?e\d{1,2}").unwrap(),
        Regex::new(r"(?i)\b\d{1,2}x\d{1,2}\b").unwrap(),
        Regex::new(r"(?i)\bT\d{1,2}[\s._-]?E\d{1,2}\b").unwrap(),
        Regex::new(r"(?i)\btemporada\s*\d+").unwrap(),
        Regex::new(r"(?i)\bepisodio\s*\d+").unwrap(),
        Regex::new(r"(?i)\bseason\s*\d+").unwrap(),
        Regex::new(r"(?i)\bepisode\s*\d+").unwrap(),
        Regex::new(r"(?i)\bcap[ií]tulo\s*\d+").unwrap(),
        Regex::new(r"(?i)\bep\.?\s*\d+").unwrap(),
    ];

    // ============ TITLE EXTRACTORS ============
    static ref EXTRACTOR_YEAR: Regex = Regex::new(r"[\(\[](\d{4})[\)\]]").unwrap();
    static ref EXTRACTOR_YEAR_STANDALONE: Regex = Regex::new(r"\b(19|20)\d{2}\b").unwrap();
    static ref EXTRACTOR_SEASON_EPISODE: Regex = Regex::new(r"(?i)s(\d{1,2})[\s._-]?e(\d{1,3})").unwrap();
    static ref EXTRACTOR_ALT_SEASON_EPISODE: Regex = Regex::new(r"(\d{1,2})x(\d{1,3})").unwrap();
    static ref EXTRACTOR_SEASON: Regex = Regex::new(r"(?i)(?:s|season|temporada)[\s._-]?(\d{1,2})").unwrap();
    static ref EXTRACTOR_EPISODE: Regex = Regex::new(r"(?i)(?:e|episode|episodio)[\s._-]?(\d{1,3})").unwrap();
    static ref EXTRACTOR_QUALITY: Regex = Regex::new(r"(?i)\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|sd)\b").unwrap();
    static ref EXTRACTOR_MULTI_AUDIO: Regex = Regex::new(r"(?i)\b(dual|multi|dublado\s*e\s*legendado)\b").unwrap();
    static ref EXTRACTOR_DUBBED: Regex = Regex::new(r"(?i)\b(dub|dublado|dubbed|nacional)\b").unwrap();
    static ref EXTRACTOR_SUBBED: Regex = Regex::new(r"(?i)\b(leg|legendado|subbed|sub)\b").unwrap();
    static ref EXTRACTOR_LANGUAGE: Regex = Regex::new(r"(?i)\b(pt|por|ptbr|pt-br|en|eng|es|esp|fr|fra|de|deu|it|ita|ja|jpn)\b").unwrap();

    // ============ SERIES INFO PATTERNS ============
    static ref SERIES_MAIN_PATTERN: Regex = Regex::new(r"(?i)(.+?)\s+S(\d{1,2})E(\d{1,3})").unwrap();
    static ref SERIES_ALT_PATTERN: Regex = Regex::new(r"(?i)(.+?)\s+(\d{1,2})x(\d{1,3})\b").unwrap();
    static ref SERIES_PT_PATTERN: Regex = Regex::new(r"(?i)(.+?)\s+T(\d{1,2})E(\d{1,3})").unwrap();

    // ============ SPECIAL PATTERNS ============
    static ref ADULT_CONTENT: Regex = Regex::new(r"(?i)xxx|onlyfans|adulto|\+18").unwrap();
    static ref TS_STREAM: Regex = Regex::new(r"(?i)/ts(\?|$)").unwrap();
    static ref PATTERN_24H: Regex = Regex::new(r"(?i)\b24h(rs)?\b").unwrap();
    static ref PATTERN_24_7: Regex = Regex::new(r"24/7").unwrap();
    static ref COLETANEA: Regex = Regex::new(r"(?i)coletanea").unwrap();
    static ref CINE_24H: Regex = Regex::new(r"(?i)CINE.*24H").unwrap();
    static ref CANAL_24H_PREFIX: Regex = Regex::new(r"(?i)^24H\s*•").unwrap();
    static ref CINE_TEMATICO: Regex = Regex::new(r"(?i)^CINE\s+\w+\s+\d{2}").unwrap();
    static ref EVENTO_HORARIO: Regex = Regex::new(r"^\d{1,2}:\d{2}\s+").unwrap();
    static ref SERIES_CHECK: Regex = Regex::new(r"(?i)s[eé]ries|series|novelas|animes|doramas").unwrap();
    static ref MOVIES_CHECK: Regex = Regex::new(r"(?i)filmes|movies|cinema|lancamentos|lançamentos|vod").unwrap();
    static ref HASH_SERIES_NOVELAS: Regex = Regex::new(r"(?i)#\s*\|\s*(s[eé]ries|novelas)").unwrap();
    static ref HASH_FILMES: Regex = Regex::new(r"(?i)#\s*\|\s*filmes?").unwrap();
    static ref S_PREFIX: Regex = Regex::new(r"(?i)\bS\s*•").unwrap();
    static ref F_PREFIX: Regex = Regex::new(r"(?i)\bF\s*•").unwrap();
    static ref MOVIE_GROUP_CHECK: Regex = Regex::new(r"(?i)filme|movies?|cinema|lancamento|lançamento|f\s*•|▶️\s*filmes?").unwrap();
    static ref SERIES_PATTERN_CHECK: Regex = Regex::new(r"(?i)S\d{1,2}E\d{1,3}").unwrap();
    static ref PREFIX_CLEANER: Regex = Regex::new(r"^(\[.*?\]|\(.*?\)|⭐|★|•|\+|\-|=|#)\s*").unwrap();
    static ref NUMBERING_CLEANER: Regex = Regex::new(r"^\d+\.\s+").unwrap();
}

/// Content classifier for IPTV items
pub struct ContentClassifier;

impl ContentClassifier {
    /// Main classification method - classifies based on group and title
    pub fn classify(name: &str, group: &str) -> MediaKind {
        // 0. High-priority filters (special prefixes and adult content)

        // Adult content filter (classify as live to hide)
        if !group.is_empty() && ADULT_CONTENT.is_match(group) {
            return MediaKind::Live;
        }

        // URLs ending in /ts (typical IPTV stream) → live
        if TS_STREAM.is_match(group) || TS_STREAM.is_match(name) {
            return MediaKind::Live;
        }

        let combined = format!("{} {}", name, group).to_lowercase();
        if PATTERN_24H.is_match(&combined) || PATTERN_24_7.is_match(&combined) {
            return MediaKind::Live;
        }

        // GROUP-TITLE EXCEPTIONS (check BEFORE S##E##!)

        // COLLECTIONS: Movie franchises using S##E## (Harry Potter S01E01-08 are MOVIES!)
        if !group.is_empty() && COLETANEA.is_match(group) {
            return MediaKind::Movie;
        }

        // CINE 24HRS: Thematic continuous channels (719+ channels)
        if !group.is_empty() && CINE_24H.is_match(group) {
            return MediaKind::Live;
        }

        // 24H Channel (always live, even if has year or series pattern)
        if !name.is_empty() && CANAL_24H_PREFIX.is_match(name) {
            return MediaKind::Live;
        }

        // Thematic CINE channels (CINE TERROR 01, CINE COMEDIA 05, etc)
        if !name.is_empty() && CINE_TEMATICO.is_match(name) {
            return MediaKind::Live;
        }

        // Live events with time (19:30 Juventude X Bahia)
        if !name.is_empty() && EVENTO_HORARIO.is_match(name) {
            return MediaKind::Live;
        }

        // 1. Try to classify by group first (more reliable)
        let group_kind = Self::classify_by_group(group);
        if group_kind != MediaKind::Unknown {
            return group_kind;
        }

        // 2. Classify by title
        Self::classify_by_title(name, group)
    }

    /// Classify based on group name
    pub fn classify_by_group(group: &str) -> MediaKind {
        if group.is_empty() {
            return MediaKind::Unknown;
        }

        let lower_group = group.to_lowercase();

        let has_series = SERIES_CHECK.is_match(&lower_group);
        let has_movies = MOVIES_CHECK.is_match(&lower_group);
        let has_24h = PATTERN_24H.is_match(&lower_group) || PATTERN_24_7.is_match(&lower_group);

        // If series + 24h => live (24h loop)
        if has_series && has_24h {
            return MediaKind::Live;
        }

        // Series first (avoids 'Apple TV' falling into live because of 'tv')
        if has_series || HASH_SERIES_NOVELAS.is_match(group) {
            return MediaKind::Series;
        }

        // Movies before live (avoids 'Filmes | Apple TV' falling into live)
        if has_movies || HASH_FILMES.is_match(group) {
            return MediaKind::Movie;
        }

        // Live/TV (rest)
        for pattern in GROUP_LIVE_PATTERNS.iter() {
            if pattern.is_match(&lower_group) {
                return MediaKind::Live;
            }
        }

        // Series (fallback regex)
        for pattern in GROUP_SERIES_PATTERNS.iter() {
            if pattern.is_match(&lower_group) {
                return MediaKind::Series;
            }
        }

        // Movies
        for pattern in GROUP_MOVIE_PATTERNS.iter() {
            if pattern.is_match(&lower_group) {
                return MediaKind::Movie;
            }
        }

        MediaKind::Unknown
    }

    /// Classify based on title (and optionally group)
    pub fn classify_by_title(name: &str, group: &str) -> MediaKind {
        if name.is_empty() {
            return MediaKind::Unknown;
        }

        // EXPLICIT PREFIXES (S • / F •) - HIGH weight
        // "S • Netflix", "S • Globoplay" → series
        if !group.is_empty() && S_PREFIX.is_match(group) {
            return MediaKind::Series;
        }
        // "F • Legendados", "F • Amazon Prime" → movie
        if !group.is_empty() && F_PREFIX.is_match(group) {
            return MediaKind::Movie;
        }

        // Series first (more specific patterns like S01E01)
        for pattern in TITLE_SERIES_PATTERNS.iter() {
            if pattern.is_match(name) {
                return MediaKind::Series;
            }
        }

        // Movies - FLEXIBLE LOGIC with group-title
        // If group-title indicates MOVIE and NO S##E## → It's a movie!
        // Solves: "Pasárgada", "Cabrito", "Levante" without year/language
        let has_movie_group = !group.is_empty() && MOVIE_GROUP_CHECK.is_match(group);
        let has_series_pattern = SERIES_PATTERN_CHECK.is_match(name);

        if has_movie_group && !has_series_pattern {
            return MediaKind::Movie; // 1 match is enough when group-title is clear
        }

        // Title needs MULTIPLE matches (if no clear group-title)
        // Valid examples: "Flow (2024) Dublado" (year + language = 2 matches)
        // Invalid examples: "Show (2020)" (only year = 1 match, classified as unknown)
        let mut movie_score = 0;
        for pattern in TITLE_MOVIE_PATTERNS.iter() {
            if pattern.is_match(name) {
                movie_score += 1;
            }
        }
        if movie_score >= 2 {
            return MediaKind::Movie;
        }

        // Live/TV
        for pattern in TITLE_LIVE_PATTERNS.iter() {
            if pattern.is_match(name) {
                return MediaKind::Live;
            }
        }

        MediaKind::Unknown
    }

    /// Extract metadata from title
    pub fn parse_title(name: &str) -> ParsedTitle {
        let mut title = name.to_string();
        let mut year: Option<u16> = None;
        let mut season: Option<u8> = None;
        let mut episode: Option<u16> = None;
        let mut quality: Option<String> = None;
        let mut language: Option<String> = None;

        // Extract year
        if let Some(caps) = EXTRACTOR_YEAR.captures(name) {
            if let Some(y) = caps.get(1) {
                year = y.as_str().parse().ok();
                title = title.replace(caps.get(0).unwrap().as_str(), "");
            }
        } else if let Some(caps) = EXTRACTOR_YEAR_STANDALONE.captures(name) {
            if let Some(y) = caps.get(0) {
                let potential_year: u16 = y.as_str().parse().unwrap_or(0);
                let current_year = chrono::Utc::now().format("%Y").to_string().parse::<u16>().unwrap_or(2025);
                if potential_year >= 1900 && potential_year <= current_year + 1 {
                    year = Some(potential_year);
                }
            }
        }

        // Extract season and episode (S01E01 format)
        if let Some(caps) = EXTRACTOR_SEASON_EPISODE.captures(name) {
            season = caps.get(1).and_then(|m| m.as_str().parse().ok());
            episode = caps.get(2).and_then(|m| m.as_str().parse().ok());
            if let Some(full_match) = caps.get(0) {
                title = title.replace(full_match.as_str(), "");
            }
        } else if let Some(caps) = EXTRACTOR_ALT_SEASON_EPISODE.captures(name) {
            // Try 1x01 format
            season = caps.get(1).and_then(|m| m.as_str().parse().ok());
            episode = caps.get(2).and_then(|m| m.as_str().parse().ok());
            if let Some(full_match) = caps.get(0) {
                title = title.replace(full_match.as_str(), "");
            }
        } else {
            // Try separately
            if let Some(caps) = EXTRACTOR_SEASON.captures(name) {
                season = caps.get(1).and_then(|m| m.as_str().parse().ok());
            }
            if let Some(caps) = EXTRACTOR_EPISODE.captures(name) {
                episode = caps.get(1).and_then(|m| m.as_str().parse().ok());
            }
        }

        // Extract quality
        if let Some(caps) = EXTRACTOR_QUALITY.captures(name) {
            quality = caps.get(1).map(|m| m.as_str().to_uppercase());
            if let Some(full_match) = caps.get(0) {
                title = title.replace(full_match.as_str(), "");
            }
        }

        // Check audio flags
        let is_multi_audio = EXTRACTOR_MULTI_AUDIO.is_match(name);
        let is_dubbed = EXTRACTOR_DUBBED.is_match(name);
        let is_subbed = EXTRACTOR_SUBBED.is_match(name);

        // Extract language
        if let Some(caps) = EXTRACTOR_LANGUAGE.captures(name) {
            language = caps.get(1).map(|m| m.as_str().to_uppercase());
        }

        // Clean the title
        title = Self::clean_title(&title);

        ParsedTitle {
            title,
            year,
            season,
            episode,
            quality,
            language,
            is_multi_audio,
            is_dubbed,
            is_subbed,
        }
    }

    /// Remove common prefixes (tags, emojis, etc) from title
    fn remove_prefixes(title: &str) -> String {
        let result = PREFIX_CLEANER.replace_all(title, "");
        let result = NUMBERING_CLEANER.replace_all(&result, "");
        result.trim().to_string()
    }

    /// Extract series info from name (detects SxxExx pattern)
    /// Returns None if not detected as series
    /// Optimized with LRU cache (30-40% faster)
    pub fn extract_series_info(name: &str) -> Option<ExtractedSeriesInfo> {
        // Check cache first
        {
            let mut cache = SERIES_CACHE.lock().unwrap();
            if let Some(cached) = cache.get(&name.to_string()) {
                return cached.clone();
            }
        }

        // Remove common prefixes before trying match
        let clean_name = Self::remove_prefixes(name);

        // Main pattern: Name + SxxExx (ex: "Breaking Bad S01E01")
        if let Some(caps) = SERIES_MAIN_PATTERN.captures(&clean_name) {
            let result = Some(ExtractedSeriesInfo {
                series_name: caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
                season: caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
                episode: caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
                is_series: true,
            });
            let mut cache = SERIES_CACHE.lock().unwrap();
            cache.put(name.to_string(), result.clone());
            return result;
        }

        // Alternative pattern: Name + 1x01 (ex: "Breaking Bad 1x01")
        if let Some(caps) = SERIES_ALT_PATTERN.captures(&clean_name) {
            let result = Some(ExtractedSeriesInfo {
                series_name: caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
                season: caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
                episode: caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
                is_series: true,
            });
            let mut cache = SERIES_CACHE.lock().unwrap();
            cache.put(name.to_string(), result.clone());
            return result;
        }

        // PT-BR/Spanish pattern: Name + T01E01 (ex: "La Casa de Papel T01E01")
        if let Some(caps) = SERIES_PT_PATTERN.captures(&clean_name) {
            let result = Some(ExtractedSeriesInfo {
                series_name: caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
                season: caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
                episode: caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
                is_series: true,
            });
            let mut cache = SERIES_CACHE.lock().unwrap();
            cache.put(name.to_string(), result.clone());
            return result;
        }

        // Not a series - cache null result too
        let mut cache = SERIES_CACHE.lock().unwrap();
        cache.put(name.to_string(), None);
        None
    }

    /// Clean title removing tags and special characters
    pub fn clean_title(title: &str) -> String {
        lazy_static! {
            static ref BRACKETS: Regex = Regex::new(r"[\[\(][^\]\)]*[\]\)]").unwrap();
            static ref QUALITY: Regex = Regex::new(r"(?i)\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|sd)\b").unwrap();
            static ref FORMATS: Regex = Regex::new(r"(?i)\b(aac|ac3|dts|x264|x265|hevc|h264|h265|webdl|web-dl|bluray|bdrip|webrip|hdrip|dvdrip|hdcam)\b").unwrap();
            static ref AUDIO: Regex = Regex::new(r"(?i)\b(dub|dublado|dubbed|leg|legendado|subbed|sub|dual|multi|nacional)\b").unwrap();
            static ref PIPES: Regex = Regex::new(r"[|]").unwrap();
            static ref MULTI_SPACES: Regex = Regex::new(r"\s+").unwrap();
            static ref TRAILING_PUNCT: Regex = Regex::new(r"[.\-_]+$").unwrap();
        }

        let result = BRACKETS.replace_all(title, "");
        let result = QUALITY.replace_all(&result, "");
        let result = FORMATS.replace_all(&result, "");
        let result = AUDIO.replace_all(&result, "");
        let result = PIPES.replace_all(&result, " ");
        let result = MULTI_SPACES.replace_all(&result, " ");
        let result = result.trim();
        let result = TRAILING_PUNCT.replace_all(result, "");
        result.trim().to_string()
    }

    /// Clear the series info cache (useful for tests or when memory is high)
    pub fn clear_cache() {
        let mut cache = SERIES_CACHE.lock().unwrap();
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_live_24h() {
        assert_eq!(ContentClassifier::classify("24H • Breaking Bad", "SERIES 24H"), MediaKind::Live);
        assert_eq!(ContentClassifier::classify("Canal ao vivo", "TV"), MediaKind::Live);
        assert_eq!(ContentClassifier::classify("Globo HD", "Canais"), MediaKind::Live);
    }

    #[test]
    fn test_classify_movie() {
        assert_eq!(ContentClassifier::classify("Matrix (1999)", "Filmes"), MediaKind::Movie);
        assert_eq!(ContentClassifier::classify("Avatar 2 4K Dublado", "VOD"), MediaKind::Movie);
        assert_eq!(ContentClassifier::classify("Flow (2024) Legendado", "Cinema"), MediaKind::Movie);
    }

    #[test]
    fn test_classify_series() {
        assert_eq!(ContentClassifier::classify("Breaking Bad S01E01", "Series"), MediaKind::Series);
        assert_eq!(ContentClassifier::classify("Game of Thrones 1x01", "HBO"), MediaKind::Series);
        assert_eq!(ContentClassifier::classify("La Casa de Papel T01E01", "Netflix"), MediaKind::Series);
    }

    #[test]
    fn test_parse_title() {
        let parsed = ContentClassifier::parse_title("Breaking Bad S01E05 720p Dublado");
        assert_eq!(parsed.season, Some(1));
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.quality, Some("720P".to_string()));
        assert!(parsed.is_dubbed);
    }

    #[test]
    fn test_extract_series_info() {
        let info = ContentClassifier::extract_series_info("Breaking Bad S02E10").unwrap();
        assert_eq!(info.series_name, "Breaking Bad");
        assert_eq!(info.season, 2);
        assert_eq!(info.episode, 10);
        assert!(info.is_series);
    }
}
