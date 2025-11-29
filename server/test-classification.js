/**
 * Test script to verify the new GROUP-TITLE PREFIX classification logic
 * Tests with real patterns from playlist_199003005_plus.m3u
 */

// Simplified classify function (copied from worker.js lines 104-234)
const classifyCache = new Map();
const MAX_CLASSIFY_CACHE = 50000;

function isLoop24h(lowerName, lowerGroup) {
  return (
    /\b24h(rs)?\b/i.test(lowerGroup) &&
    /\s\d{1,2}$/.test(lowerName) &&
    !/\bs\d{1,2}e\d{1,3}\b/i.test(lowerName)
  );
}

function classify(name, group) {
  const cacheKey = `${name}|${group}`;
  if (classifyCache.has(cacheKey)) {
    return classifyCache.get(cacheKey);
  }

  const lowerName = name.toLowerCase();
  const lowerGroup = group.toLowerCase();

  // ===================================================================
  // PRIORITY 1: GROUP-TITLE PREFIX (Primary Classification System)
  // ===================================================================

  // 1.1. LIVE - Star prefix (⭐)
  if (group.startsWith('⭐')) {
    classifyCache.set(cacheKey, 'live');
    return 'live';
  }

  // 1.2. SERIES - "S • " prefix
  if (group.startsWith('S • ')) {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 1.3. SERIES - "Series | " prefix
  if (group.startsWith('Series | ')) {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 1.4. SERIES - Exact match "Novelas"
  if (group === 'Novelas') {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 1.5. FILMS - "F • " prefix
  if (group.startsWith('F • ')) {
    classifyCache.set(cacheKey, 'movie');
    return 'movie';
  }

  // 1.6. FILMS - "Filmes | " prefix
  if (group.startsWith('Filmes | ')) {
    classifyCache.set(cacheKey, 'movie');
    return 'movie';
  }

  // ===================================================================
  // PRIORITY 2: ITEM NAME PATTERNS (Secondary Classification)
  // ===================================================================

  // 2.1. 24h Loop Channels - "24H • " prefix in NAME
  if (name.startsWith('24H • ')) {
    classifyCache.set(cacheKey, 'live');
    return 'live';
  }

  // 2.2. Canais 24h com numeração sequencial
  const is24hChannel =
    /\b24h(rs)?\b/i.test(lowerGroup) &&
    /\s\d{1,2}$/.test(name);

  // 2.3. Canais de TV com qualidade no nome
  const isTVChannel =
    /\b(FHD|HD|SD)\b/i.test(name) ||
    /\[ALT\]/i.test(name);

  if (is24hChannel || isTVChannel) {
    classifyCache.set(cacheKey, 'live');
    return 'live';
  }

  // 2.4. Series Episodes - SxxExx pattern
  const isSeriesTitle =
    /s\d{1,2}e\d{1,3}/i.test(lowerName) ||
    /\d{1,2}x\d{1,3}/.test(lowerName) ||
    /\b(temporada|season|epis[oó]dio|episode|ep\.)\b/i.test(lowerName);

  if (isSeriesTitle) {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 2.5. Movies with Year - (19xx) or (20xx) in name
  const hasYearMovie = /\b(19|20)\d{2}\b/.test(lowerName);
  if (hasYearMovie) {
    classifyCache.set(cacheKey, 'movie');
    return 'movie';
  }

  // ===================================================================
  // PRIORITY 3: KEYWORD FALLBACK (Last Resort)
  // ===================================================================

  const isSeriesGroup =
    /\b(series?|s[eé]ries|novelas?|doramas?|animes?)\b/i.test(lowerGroup) ||
    /\b(netflix|hbo|disney|amazon|paramount|apple|star)\b/i.test(lowerGroup);

  const isLoop = isLoop24h(lowerName, lowerGroup);
  const isSports = /\b(futebol|jogos|sports?|espn|premiere|sportv|copa|libertadores)\b/i.test(lowerGroup);
  const isNews = /\b(news|cnn|bandnews|globonews)\b/i.test(lowerGroup);
  const isLiveKeywords =
    /\b(live|ao vivo|tv|canal|canais?)\b/i.test(lowerGroup) ||
    /\b(live|ao vivo|tv)\b/i.test(lowerName);

  const isMovieGroup =
    /\b(filmes?|movies?|cinema|vod)\b/i.test(lowerGroup) ||
    /\b(acao|terror|comedia|drama|ficcao|aventura|animacao|suspense|romance)\b/i.test(lowerGroup);

  // Priority for fallback
  let result;
  if (isSports || isNews || isLiveKeywords || isLoop) result = 'live';
  else if (isSeriesGroup) result = 'series';
  else if (isMovieGroup) result = 'movie';
  else result = 'unknown';

  // Cache result (with size limit)
  if (classifyCache.size >= MAX_CLASSIFY_CACHE) {
    const firstKey = classifyCache.keys().next().value;
    classifyCache.delete(firstKey);
  }
  classifyCache.set(cacheKey, result);

  return result;
}

// Test cases from real M3U patterns
const testCases = [
  // SERIES with "S • " prefix (should be 'series')
  { name: 'Caçada no Deserto: O Caso Adam Nayeri (LEG) S01E01', group: 'S • Legendados', expected: 'series' },
  { name: 'Breaking Bad S01E01', group: 'S • Netflix', expected: 'series' },
  { name: 'Game of Thrones S01E01', group: 'S • Amazon Prime Video', expected: 'series' },
  { name: 'Episódio qualquer', group: 'S • Produtoras Independentes', expected: 'series' },

  // SERIES with "Series | " prefix (should be 'series')
  { name: 'Stranger Things S01E01', group: 'Series | Netflix', expected: 'series' },
  { name: 'The Office S01E01', group: 'Series | Legendadas', expected: 'series' },

  // SERIES with "Novelas" group (should be 'series')
  { name: 'A Favorita Ep 01', group: 'Novelas', expected: 'series' },

  // FILMS with "F • " prefix (should be 'movie')
  { name: 'The Matrix', group: 'F • Legendados', expected: 'movie' },
  { name: 'Inception', group: 'F • Amazon Prime Video', expected: 'movie' },
  { name: 'XXX', group: 'F • XXX Adultos +18', expected: 'movie' },

  // FILMS with "Filmes | " prefix (should be 'movie')
  { name: 'The Godfather', group: 'Filmes | Drama', expected: 'movie' },
  { name: 'Superbad', group: 'Filmes | Comedia', expected: 'movie' },

  // LIVE with "⭐" prefix (should be 'live')
  { name: 'Globo RJ', group: '⭐ Canais | Globo', expected: 'live' },
  { name: 'The Office 24H', group: '⭐ SERIES 24H', expected: 'live' },
  { name: 'Naruto Shippuden', group: '⭐ DESENHOS 24H', expected: 'live' },

  // LIVE with "24H • " in NAME (should be 'live')
  { name: '24H • 18 Outra Vez', group: '⭐ Canais | DORAMAS 24H', expected: 'live' },
  { name: '24H • Breaking Bad', group: 'Qualquer Grupo', expected: 'live' },
];

// Run tests
console.log('🧪 Testing Classification Logic\n');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const result = classify(test.name, test.group);
  const success = result === test.expected;

  if (success) {
    passed++;
    console.log(`✅ Test ${index + 1}: PASSED`);
  } else {
    failed++;
    console.log(`❌ Test ${index + 1}: FAILED`);
    console.log(`   Name: "${test.name}"`);
    console.log(`   Group: "${test.group}"`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Got: ${result}`);
  }
});

console.log('='.repeat(80));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
console.log(`✅ Success rate: ${((passed / testCases.length) * 100).toFixed(1)}%\n`);

if (failed === 0) {
  console.log('🎉 All tests passed! Classification logic is working correctly.\n');
  console.log('Expected behavior based on M3U analysis:');
  console.log('- ~706k items (85%) should be classified as SERIES (S •, Series |, Novelas)');
  console.log('- ~26k items (3%) should be classified as MOVIE (F •, Filmes |)');
  console.log('- ~1k items (0.1%) should be classified as LIVE (⭐, 24H)');
  console.log('- ~12% fallback to keyword-based classification');
} else {
  console.log('⚠️  Some tests failed. Review the classification logic.');
  process.exit(1);
}
