/**
 * Series Grouper
 * Agrupa episódios de séries usando algoritmo de similaridade de nomes
 */

import type { M3UItem, Series } from '@core/db';
import { ContentClassifier, type SeriesInfo } from './classifier';

const SIMILARITY_THRESHOLD = 0.85; // 85% de similaridade = mesma série

/**
 * Calcula a distância de Levenshtein entre duas strings
 * Retorna o número de operações (inserção, deleção, substituição) necessárias
 */
function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  // Inicializa primeira coluna (0 a len1)
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  // Inicializa primeira linha (0 a len2)
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Preenche a matriz com custos de operações
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Normaliza nome para comparação
 * Remove pontuação e sufixos de idioma, preservando a estrutura do nome
 * IMPORTANTE: Remove pt/br apenas como sufixo para não quebrar nomes como "Restart", "Brother"
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(pt-br|pt|br)$/i, '')  // Remove APENAS sufixos de idioma (final da string)
    .replace(/[^a-z0-9\s]/g, '')        // Remove pontuação (preserva espaços)
    .replace(/\s+/g, ' ')               // Normaliza múltiplos espaços
    .trim();
}

/**
 * Calcula similaridade entre dois nomes (0-1)
 * 1 = idênticos, 0 = completamente diferentes
 */
function calculateSimilarity(name1: string, name2: string): number {
  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (n1 === n2) return 1.0;

  // Levenshtein distance normalizado
  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);

  if (maxLen === 0) return 0;

  return 1 - (distance / maxLen);
}

/**
 * Extrai "base name" removendo S01E01, ano, qualidade, etc
 */
function extractBaseName(name: string): string {
  return name
    .replace(/\s+S\d{1,2}E\d{1,2}.*/i, '')  // Remove S01E01...
    .replace(/\s+\d{1,2}x\d{1,2}.*/i, '')   // Remove 1x01...
    .replace(/\s+T\d{1,2}E\d{1,2}.*/i, '')  // Remove T01E01...
    .replace(/\(\d{4}\)/g, '')              // Remove (2024)
    .replace(/\[\d{4}\]/g, '')              // Remove [2024]
    .replace(/\b(1080p|720p|4k|hd|fhd|uhd)\b/gi, '')
    .trim();
}

/**
 * Agrupa episódios por similaridade de nome
 * Retorna Map onde chave = nome base da série, valor = array de episódios
 */
export function groupEpisodesBySimilarity(items: M3UItem[]): Map<string, M3UItem[]> {
  const groups = new Map<string, M3UItem[]>();

  for (const item of items) {
    const baseName = extractBaseName(item.name);
    let foundGroup = false;

    // Tenta encontrar grupo similar existente
    for (const [groupName, episodes] of groups.entries()) {
      const similarity = calculateSimilarity(baseName, groupName);

      if (similarity >= SIMILARITY_THRESHOLD) {
        episodes.push(item);
        foundGroup = true;
        break;
      }
    }

    // Se não encontrou grupo similar, cria novo
    if (!foundGroup) {
      groups.set(baseName, [item]);
    }
  }

  return groups;
}

/**
 * Cria um slug para ID da série baseado no nome
 */
function createSeriesSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50); // Limita tamanho
}

/**
 * Agrupa itens de séries e cria registros de Series
 * @param items - Itens já filtrados como mediaKind='series'
 * @param playlistId - ID da playlist
 * @returns Objeto com séries criadas e mapeamento item->série
 */
export function groupSeriesEpisodes(
  items: M3UItem[],
  playlistId: string
): {
  series: Series[];
  itemToSeriesMap: Map<string, { seriesId: string; seasonNumber: number; episodeNumber: number }>;
} {
  const series: Series[] = [];
  const itemToSeriesMap = new Map<string, { seriesId: string; seasonNumber: number; episodeNumber: number }>();

  // 1. Separa itens com padrão claro (SxxExx) dos sem padrão
  const itemsWithPattern: Array<{ item: M3UItem; info: SeriesInfo }> = [];
  const itemsWithoutPattern: M3UItem[] = [];

  for (const item of items) {
    const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);
    if (seriesInfo) {
      itemsWithPattern.push({ item, info: seriesInfo });
    } else {
      itemsWithoutPattern.push(item);
    }
  }

  // 2. Agrupa itens COM padrão por nome da série
  const patternGroups = new Map<string, Array<{ item: M3UItem; info: SeriesInfo }>>();

  for (const { item, info } of itemsWithPattern) {
    const seriesName = info.seriesName;

    // Busca grupo similar
    let foundGroup = false;
    for (const [groupName, episodes] of patternGroups.entries()) {
      const similarity = calculateSimilarity(seriesName, groupName);

      if (similarity >= SIMILARITY_THRESHOLD) {
        episodes.push({ item, info });
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      patternGroups.set(seriesName, [{ item, info }]);
    }
  }

  // 3. Agrupa itens SEM padrão por similaridade de nome
  const noPatterGroups = groupEpisodesBySimilarity(itemsWithoutPattern);

  // 4. Cria registros de Series para grupos COM padrão
  for (const [seriesName, episodes] of patternGroups.entries()) {
    // Pega primeiro episódio como referência
    const firstEpisode = episodes[0];
    const slug = createSeriesSlug(seriesName);
    const seriesId = `series_${playlistId}_${slug}`;

    // Calcula estatísticas
    const seasons = new Set(episodes.map((e) => e.info.season));
    const episodeNumbers = episodes.map((e) => e.info.episode);
    const seasonNumbers = episodes.map((e) => e.info.season);

    const seriesRecord: Series = {
      id: seriesId,
      playlistId,
      name: seriesName,
      logo: firstEpisode.item.logo || '',
      group: firstEpisode.item.group,
      totalEpisodes: episodes.length,
      totalSeasons: seasons.size,
      firstEpisode: Math.min(...episodeNumbers),
      lastEpisode: Math.max(...episodeNumbers),
      firstSeason: Math.min(...seasonNumbers),
      lastSeason: Math.max(...seasonNumbers),
      createdAt: Date.now(),
    };

    series.push(seriesRecord);

    // Mapeia items para série
    for (const { item, info } of episodes) {
      itemToSeriesMap.set(item.id, {
        seriesId,
        seasonNumber: info.season,
        episodeNumber: info.episode,
      });
    }
  }

  // 5. Cria registros de Series para grupos SEM padrão (se tiver múltiplos episódios)
  for (const [baseName, episodes] of noPatterGroups.entries()) {
    // Só cria série se tiver 2+ episódios
    if (episodes.length < 2) {
      continue; // Deixa como item individual
    }

    const firstEpisode = episodes[0];
    const slug = createSeriesSlug(baseName);
    const seriesId = `series_${playlistId}_${slug}`;

    const seriesRecord: Series = {
      id: seriesId,
      playlistId,
      name: baseName,
      logo: firstEpisode.logo || '',
      group: firstEpisode.group,
      totalEpisodes: episodes.length,
      totalSeasons: 1, // Assume 1 temporada se não tiver padrão
      firstEpisode: 1,
      lastEpisode: episodes.length,
      firstSeason: 1,
      lastSeason: 1,
      createdAt: Date.now(),
    };

    series.push(seriesRecord);

    // Mapeia items para série (usa índice como episódio)
    episodes.forEach((item, index) => {
      itemToSeriesMap.set(item.id, {
        seriesId,
        seasonNumber: 1,
        episodeNumber: index + 1,
      });
    });
  }

  return { series, itemToSeriesMap };
}
