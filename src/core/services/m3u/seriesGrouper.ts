/**
 * Series Grouper - FASE 1 Refactored
 * Merge fuzzy de singletons em grupos multi-episódio
 * Recebe series groups já criados pelo hash-based grouping do batchProcessor
 */

import { db, type Series } from '@core/db';
import { normalizeSeriesName } from './utils';
import type { SeriesGroup } from './batchProcessor';

const SIMILARITY_THRESHOLD = 0.85; // 85% de similaridade = mesma série
const MAX_COMPARISONS_PER_SINGLETON = 50; // Limita comparações para performance

/**
 * Calcula a distância de Levenshtein entre duas strings usando algoritmo otimizado (2-row)
 * Baseado na implementação do server/worker.js (linhas 409-439)
 *
 * Complexity: O(min(len1, len2)) em espaço (2 linhas apenas)
 * Complexity: O(len1 * len2) em tempo
 */
function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;

  // Edge cases
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  // Optimization: use 2 rows instead of full matrix
  let prevRow = Array.from({ length: len2 + 1 }, (_, i) => i);
  let currRow = Array(len2 + 1).fill(0);

  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;

    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,         // deletion
        currRow[j - 1] + 1,     // insertion
        prevRow[j - 1] + cost   // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[len2];
}

/**
 * Calcula similaridade entre dois nomes normalizados (0-1)
 * 1 = idênticos, 0 = completamente diferentes
 */
function calculateSimilarity(name1: string, name2: string): number {
  if (name1 === name2) return 1.0;

  const distance = levenshteinDistance(name1, name2);
  const maxLen = Math.max(name1.length, name2.length);

  if (maxLen === 0) return 0;

  return 1 - (distance / maxLen);
}

/**
 * Merge fuzzy de series groups (apenas singletons)
 * FASE 1: Implementação do algoritmo híbrido
 *
 * @param seriesGroups - Groups criados pelo hash-based grouping do batchProcessor
 * @param playlistId - ID da playlist
 * @param similarityThreshold - Threshold de similaridade (default: 0.85)
 * @returns Array de Series records para salvar no DB
 */
export async function mergeSeriesGroups(
  seriesGroups: SeriesGroup[],
  playlistId: string,
  similarityThreshold: number = SIMILARITY_THRESHOLD
): Promise<Series[]> {
  console.log(`[Series Merge] Iniciando merge de ${seriesGroups.length} series groups...`);

  // Separa singletons (1 episódio) de multi-episode (2+)
  const singletons = seriesGroups.filter(g => g.episodeCount === 1);
  const multiEpisode = seriesGroups.filter(g => g.episodeCount > 1);

  console.log(`[Series Merge] ${singletons.length} singletons, ${multiEpisode.length} multi-episode groups`);

  // Map para tracking de merges: singletonKey -> targetKey
  const mergeMap = new Map<string, string>();

  // ✅ OTIMIZAÇÃO: Indexa multi-episode groups por primeira palavra
  const indexByFirstWord = new Map<string, string[]>();
  for (const group of multiEpisode) {
    const firstWord = group.seriesName.split(' ')[0].toLowerCase();
    if (!indexByFirstWord.has(firstWord)) {
      indexByFirstWord.set(firstWord, []);
    }
    indexByFirstWord.get(firstWord)!.push(group.seriesKey);
  }

  console.log(`[Series Merge] Index criado com ${indexByFirstWord.size} palavras únicas`);

  // ✅ FUZZY MATCH: Apenas singletons vs multi-episode groups
  let comparisonCount = 0;
  let mergeCount = 0;

  for (const singleton of singletons) {
    const firstWord = singleton.seriesName.split(' ')[0].toLowerCase();
    const candidates = indexByFirstWord.get(firstWord) || [];

    if (candidates.length === 0) {
      continue; // Sem candidatos com mesma primeira palavra
    }

    let bestMatch: { key: string; similarity: number } | null = null;

    // Limita comparações para performance
    const candidatesToCheck = candidates.slice(0, MAX_COMPARISONS_PER_SINGLETON);

    for (const candidateKey of candidatesToCheck) {
      const candidate = multiEpisode.find(g => g.seriesKey === candidateKey);
      if (!candidate) continue;

      // Normaliza nomes antes de comparar
      const normalizedSingleton = normalizeSeriesName(singleton.seriesName);
      const normalizedCandidate = normalizeSeriesName(candidate.seriesName);

      const similarity = calculateSimilarity(normalizedSingleton, normalizedCandidate);
      comparisonCount++;

      if (similarity >= similarityThreshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { key: candidateKey, similarity };
        }
      }
    }

    if (bestMatch) {
      mergeMap.set(singleton.seriesKey, bestMatch.key);
      mergeCount++;

      const target = multiEpisode.find(g => g.seriesKey === bestMatch!.key)!;
      console.log(
        `[Series Merge] "${singleton.seriesName}" → "${target.seriesName}" (${(bestMatch.similarity * 100).toFixed(1)}%)`
      );
    }
  }

  console.log(`[Series Merge] ${mergeCount} singletons merged (${comparisonCount} comparisons)`);

  // ✅ APLICA MERGES: Atualiza metadata dos grupos multi-episódio
  for (const [singletonKey, targetKey] of mergeMap.entries()) {
    const singleton = singletons.find(g => g.seriesKey === singletonKey)!;
    const target = multiEpisode.find(g => g.seriesKey === targetKey)!;

    // Merge metadata
    target.itemIds.push(...singleton.itemIds);
    target.episodeCount += singleton.episodeCount;
    target.seasons = new Set([...target.seasons, ...singleton.seasons]);
  }

  // ✅ ATUALIZA ITEMS NO DB: Corrige seriesId dos items que foram merged
  await updateItemsSeriesId(mergeMap, playlistId);

  // ✅ CRIA SERIES RECORDS FINAIS
  const finalSeries: Series[] = [];

  // Multi-episode groups (incluindo merged singletons)
  for (const group of multiEpisode) {
    // Busca primeiro item para pegar logo e group
    const firstItemId = `${playlistId}_${group.itemIds[0]}`;
    const firstItem = await db.items.get(firstItemId);

    finalSeries.push({
      id: `${playlistId}_${group.seriesKey}`,
      playlistId,
      name: group.seriesName,
      logo: firstItem?.logo || '',
      group: firstItem?.group || '',
      totalEpisodes: group.episodeCount,
      totalSeasons: group.seasons.size,
      firstSeason: Math.min(...group.seasons),
      lastSeason: Math.max(...group.seasons),
      firstEpisode: 1, // TODO: calcular min episode number
      lastEpisode: group.episodeCount, // TODO: calcular max episode number
      createdAt: Date.now(),
    });
  }

  // Singletons NÃO merged: também viram Series (para permitir expand futuro)
  for (const singleton of singletons) {
    if (mergeMap.has(singleton.seriesKey)) {
      continue; // Já foi merged, skip
    }

    const firstItemId = `${playlistId}_${singleton.itemIds[0]}`;
    const firstItem = await db.items.get(firstItemId);

    finalSeries.push({
      id: `${playlistId}_${singleton.seriesKey}`,
      playlistId,
      name: singleton.seriesName,
      logo: firstItem?.logo || '',
      group: firstItem?.group || '',
      totalEpisodes: 1,
      totalSeasons: 1,
      firstSeason: 0,
      lastSeason: 0,
      firstEpisode: 1,
      lastEpisode: 1,
      createdAt: Date.now(),
    });
  }

  console.log(`[Series Merge] ${finalSeries.length} séries finais criadas`);

  return finalSeries;
}

/**
 * Atualiza seriesId dos items que foram merged
 * @param mergeMap - Map de oldKey -> newKey (singletons que foram merged)
 * @param playlistId - ID da playlist
 */
async function updateItemsSeriesId(
  mergeMap: Map<string, string>,
  playlistId: string
): Promise<void> {
  if (mergeMap.size === 0) {
    return; // Nenhum merge para aplicar
  }

  console.log(`[Series Merge] Atualizando ${mergeMap.size} items com novo seriesId...`);

  // Busca todos os items que precisam ser atualizados
  const oldKeys = Array.from(mergeMap.keys());
  const itemsToUpdate = await db.items
    .where('playlistId')
    .equals(playlistId)
    .and(item => oldKeys.includes(item.seriesId || ''))
    .toArray();

  console.log(`[Series Merge] ${itemsToUpdate.length} items encontrados para atualização`);

  // Atualiza seriesId
  const updated = itemsToUpdate.map(item => ({
    ...item,
    seriesId: mergeMap.get(item.seriesId || '') || item.seriesId,
  }));

  // Salva no DB
  if (updated.length > 0) {
    try {
      await db.items.bulkPut(updated);
      console.log(`[Series Merge] ✓ ${updated.length} items atualizados`);
    } catch (error) {
      console.error('[Series Merge] Erro ao atualizar items:', error);

      // Fallback: atualiza item por item
      let successCount = 0;
      for (const item of updated) {
        try {
          await db.items.put(item);
          successCount++;
        } catch (e) {
          console.error(`[Series Merge] Erro ao atualizar item ${item.id}:`, e);
        }
      }
      console.log(`[Series Merge] ${successCount}/${updated.length} items atualizados (fallback)`);
    }
  }
}
