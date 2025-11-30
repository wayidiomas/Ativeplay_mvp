/**
 * Batch Processor
 * Processa itens do streaming parser em lotes, mantendo UI responsiva
 * FASE 1: Adiciona series grouping híbrido (hash-based durante streaming)
 * FASE 7.2: Adiciona criação incremental de Series no DB
 */

import { db, type M3UItem, type Series } from '@core/db/schema';
import { ContentClassifier } from './classifier';
import { normalizeSeriesName, createSeriesKey, normalizeGroup, normalizeTitle, hashURL, isValidStreamURL } from './utils';
import { getBatchConfig } from './deviceDetection'; // ✅ FASE 2: Device-adaptive config
import type {
  M3UParsedItem,
  M3UGroup,
  M3UPlaylist,
  PlaylistStats,
  ParserProgress,
  MediaKind,
} from './types';

export type ProgressCallback = (progress: ParserProgress) => void;

const YIELD_INTERVAL = 0; // Yield para UI (setTimeout 0ms)

// ✅ NOVO: Series Run-Length Encoding (RLE)
// Detecta quando episodes consecutivos pertencem à mesma série
interface SeriesRun {
  seriesKey: string;
  seriesDbId: string;
  seriesName: string;
  group: string;
  year?: number;
  logo: string;
  quality?: string;
  episodes: Array<{
    season: number;
    episode: number;
    itemId: string;
  }>;
}

// ✅ FASE 2: REMOVIDO - Agora usa config adaptativo
// const BATCH_SIZE = 100;
// const GC_INTERVAL = 10;

// Interface para tracking de séries durante streaming
export interface SeriesGroup {
  seriesKey: string;      // Hash normalizado (ID único)
  seriesName: string;     // Nome original da série
  itemIds: string[];      // IDs dos episódios
  seasons: Set<number>;   // Temporadas únicas
  episodeCount: number;   // Total de episódios
}

/**
 * Gera ID único para um grupo
 */
function generateGroupId(name: string, mediaKind: MediaKind): string {
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `group_${safeName}_${mediaKind}`;
}

/**
 * ✅ NOVO: Flush Series Run (RLE Optimization)
 * Processa run de episódios consecutivos da mesma série em bloco
 *
 * Benefícios:
 * - 1 normalização (vs N para cada episódio)
 * - 1 hash calculation (vs N)
 * - 1 DB query (vs N)
 * - 1 DB update (vs N)
 *
 * Exemplo: Breaking Bad com 62 episódios = 62x menos operações
 */
async function flushSeriesRun(run: SeriesRun, playlistId: string): Promise<void> {
  if (run.episodes.length === 0) return;

  const { seriesDbId, seriesName, group, logo, year, quality, episodes } = run;

  // Calcula stats agregados do RUN
  const seasons = new Set(episodes.map(e => e.season));
  const allSeasons = Array.from(seasons).sort((a, b) => a - b);
  const firstEp = episodes[0];
  const lastEp = episodes[episodes.length - 1];

  // ✅ UMA ÚNICA verificação de existência
  const existing = await db.series.get(seriesDbId);

  if (!existing) {
    // ✅ CRIA série com stats completos do RUN
    const newSeries: Series = {
      id: seriesDbId,
      playlistId,
      name: seriesName,
      logo: logo || '',
      group,
      totalEpisodes: episodes.length,
      totalSeasons: allSeasons.length,
      firstSeason: allSeasons[0],
      lastSeason: allSeasons[allSeasons.length - 1],
      firstEpisode: firstEp.episode,
      lastEpisode: lastEp.episode,
      year,
      quality,
      createdAt: Date.now(),
    };

    await db.series.add(newSeries);

    console.log(
      '[SeriesRLE] Created "' + seriesName + '": ' + episodes.length + ' eps ' +
      '(S' + String(allSeasons[0]).padStart(2, '0') + '-S' + String(allSeasons[allSeasons.length - 1]).padStart(2, '0') + ')'
    );
  } else {
    // ✅ ATUALIZA série existente com stats agregados do RUN
    const existingSeasons = new Set<number>();
    for (let s = existing.firstSeason; s <= existing.lastSeason; s++) {
      existingSeasons.add(s);
    }
    allSeasons.forEach(s => existingSeasons.add(s));
    const mergedSeasons = Array.from(existingSeasons).sort((a, b) => a - b);

    const updates: Partial<Series> = {
      totalEpisodes: existing.totalEpisodes + episodes.length,
      totalSeasons: mergedSeasons.length,
      firstSeason: mergedSeasons[0],
      lastSeason: mergedSeasons[mergedSeasons.length - 1],
      firstEpisode: Math.min(existing.firstEpisode || Infinity, firstEp.episode),
      lastEpisode: Math.max(existing.lastEpisode || 0, lastEp.episode),
    };

    await db.series.update(seriesDbId, updates);

    console.log(
      '[SeriesRLE] Updated "' + seriesName + '": +' + episodes.length + ' eps ' +
      '(total: ' + (existing.totalEpisodes + episodes.length) + ')'
    );
  }
}

/**
 * Processa itens do stream em lotes e insere no banco
 * FASE 1: Adiciona series grouping incremental (hash-based)
 *
 * @param generator AsyncGenerator que produz itens parseados
 * @param playlistId ID da playlist
 * @param onProgress Callback de progresso
 * @returns Playlist completa com stats, grupos e seriesGroups
 */
export async function processBatches(
  generator: AsyncGenerator<M3UParsedItem>,
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<Omit<M3UPlaylist, 'url'> & { seriesGroups: SeriesGroup[] }> {
  // ✅ FASE 2: Config adaptativo baseado no device
  const config = getBatchConfig();
  const BATCH_SIZE = config.itemBatchSize;
  const GC_INTERVAL = config.gcInterval;

  const groupsMap = new Map<string, M3UGroup>();
  const seriesGroupsMap = new Map<string, SeriesGroup>(); // ✅ FASE 1: Series tracking
  const stats: PlaylistStats = {
    totalItems: 0,
    liveCount: 0,
    movieCount: 0,
    seriesCount: 0,
    unknownCount: 0,
    groupCount: 0,
  };

  let batch: M3UParsedItem[] = [];
  let totalProcessed = 0;
  let batchCount = 0; // ✅ FASE 1: Para GC interval

  // ✅ NOVO: Series Run-Length Encoding (RLE)
  // Detecta quando episodes consecutivos pertencem à mesma série
  let currentSeriesRun: SeriesRun | null = null;

  try {
    for await (const item of generator) {
      batch.push(item);
      // NOTE: Não acumulamos items em memória para economizar RAM
      // Os items são inseridos no DB progressivamente

      // Update stats
      stats.totalItems++;
      switch (item.mediaKind) {
        case 'live':
          stats.liveCount++;
          break;
        case 'movie':
          stats.movieCount++;
          break;
        case 'series':
          stats.seriesCount++;
          break;
        default:
          stats.unknownCount++;
      }

      // Update groups map
      const groupId = generateGroupId(item.group, item.mediaKind);
      const existingGroup = groupsMap.get(groupId);
      if (existingGroup) {
        existingGroup.itemCount++;
      } else {
        groupsMap.set(groupId, {
          id: groupId,
          name: item.group,
          mediaKind: item.mediaKind,
          itemCount: 1,
          logo: item.logo,
        });
      }

      // ✅ NOVO: Series RLE (Run-Length Encoding) - Detecção de runs consecutivos
      if (item.mediaKind === 'series' && item.parsedTitle?.season) {
        const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);

        if (seriesInfo) {
          // Normaliza nome APENAS uma vez por RUN (não por item)
          const normalized = normalizeSeriesName(seriesInfo.seriesName);
          const seriesKey = createSeriesKey(normalized, item.group, item.parsedTitle.year);
          const seriesDbId = `${playlistId}_${seriesKey}`;

          // ✅ DETECÇÃO DE RUN: Verifica se pertence ao mesmo run
          if (!currentSeriesRun || currentSeriesRun.seriesKey !== seriesKey) {
            // NOVO RUN: Flush run anterior se houver
            if (currentSeriesRun) {
              await flushSeriesRun(currentSeriesRun, playlistId);
            }

            // Inicia novo run
            currentSeriesRun = {
              seriesKey,
              seriesDbId,
              seriesName: seriesInfo.seriesName,
              group: item.group,
              year: item.parsedTitle.year,
              logo: item.logo || '',
              quality: item.parsedTitle.quality,
              episodes: [],
            };
          }

          // ✅ ACUMULA episódio no RUN atual
          currentSeriesRun.episodes.push({
            season: seriesInfo.season,
            episode: seriesInfo.episode,
            itemId: item.id,
          });

          // ✅ Mantém compatibilidade com seriesGroupsMap (usado pelo fuzzy merge)
          if (!seriesGroupsMap.has(seriesKey)) {
            seriesGroupsMap.set(seriesKey, {
              seriesKey,
              seriesName: seriesInfo.seriesName,
              itemIds: [],
              seasons: new Set(),
              episodeCount: 0,
            });
          }

          const group = seriesGroupsMap.get(seriesKey)!;
          group.itemIds.push(item.id);
          group.seasons.add(seriesInfo.season);
          group.episodeCount++;
        }
      } else {
        // Item NÃO é série: flush run atual se houver
        if (currentSeriesRun) {
          await flushSeriesRun(currentSeriesRun, playlistId);
          currentSeriesRun = null;
        }
      }

      // Processa batch quando atingir tamanho limite
      if (batch.length >= BATCH_SIZE) {
        // ✅ FASE OTIMIZAÇÃO: Filtra URLs inválidas antes de processar
        const validBatch = batch.filter((item) => {
          const isValid = isValidStreamURL(item.url);
          if (!isValid) {
            console.warn(`[BatchProcessor] URL inválida rejeitada: ${item.name} (${item.url.substring(0, 50)}...)`);
          }
          return isValid;
        });

        // Prepara itens para inserção no DB
        const dbItems: M3UItem[] = validBatch.map((item) => {
          // ✅ NOVO: Extrai seriesId para items de séries
          const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);
          let seriesId: string | undefined;
          let seasonNumber: number | undefined;
          let episodeNumber: number | undefined;

          if (seriesInfo && item.mediaKind === 'series') {
            const normalized = normalizeSeriesName(seriesInfo.seriesName);
            const seriesKey = createSeriesKey(normalized, item.group, item.parsedTitle.year);
            seriesId = `${playlistId}_${seriesKey}`;
            seasonNumber = seriesInfo.season;
            episodeNumber = seriesInfo.episode;
          }

          return {
            id: `${playlistId}_${item.id}`,
            playlistId,
            name: item.name,
            url: item.url,
            logo: item.logo,
            group: item.group,
            mediaKind: item.mediaKind,
            title: item.parsedTitle.title,
            titleNormalized: normalizeTitle(item.parsedTitle.title || item.name),  // ✅ FASE OTIMIZAÇÃO
            groupNormalized: normalizeGroup(item.group),                          // ✅ FASE OTIMIZAÇÃO
            urlHash: hashURL(item.url),                                           // ✅ FASE OTIMIZAÇÃO
            year: item.parsedTitle.year,
            season: item.parsedTitle.season,
            episode: item.parsedTitle.episode,
            quality: item.parsedTitle.quality,
            epgId: item.epgId,
            seriesId,        // ✅ NOVO
            seasonNumber,    // ✅ NOVO
            episodeNumber,   // ✅ NOVO
            createdAt: Date.now(),
          };
        });

        // Insere no DB com fallback triplo
        try {
          await db.items.bulkAdd(dbItems);
        } catch (error) {
          console.warn('[BatchProcessor] bulkAdd falhou, tentando bulkPut (upsert):', (error as Error).message);

          try {
            // Fallback: upsert (substitui duplicatas)
            await db.items.bulkPut(dbItems);
            console.log('[BatchProcessor] ✓ Batch salvo via bulkPut (upsert)');
          } catch (putError) {
            console.error('[BatchProcessor] ❌ ERRO CRÍTICO: batch pode ser perdido', {
              batchSize: dbItems.length,
              error: (putError as Error).message,
              firstItem: dbItems[0]?.id,
              lastItem: dbItems[dbItems.length - 1]?.id,
            });

            // ⚠️ Última tentativa: insere item por item
            let savedCount = 0;
            for (const item of dbItems) {
              try {
                await db.items.put(item);
                savedCount++;
              } catch {
                console.error('[BatchProcessor] Item rejeitado:', item.id);
              }
            }

            console.warn(`[BatchProcessor] Salvou ${savedCount}/${dbItems.length} items individualmente`);
          }
        }

        // ✅ RLE: Series são criadas/atualizadas via flushSeriesRun() automaticamente
        // Não precisa mais de batch operations manuais aqui

        // ✅ FIX: Flush groups to DB during batch processing (UI lazy loading fix)
        // Salva grupos incrementalmente para que UI possa mostrar conteúdo durante parsing
        if (groupsMap.size > 0) {
          const dbGroups = Array.from(groupsMap.values()).map((group) => ({
            id: `${playlistId}_${group.id}`,
            playlistId,
            name: group.name,
            mediaKind: group.mediaKind,
            itemCount: group.itemCount,
            logo: group.logo,
            createdAt: Date.now(),
          }));

          try {
            // Use bulkPut (upsert) para atualizar counts incrementalmente
            await db.groups.bulkPut(dbGroups);
            console.log(`[Groups] ✅ ${dbGroups.length} grupos salvos/atualizados`);
          } catch (err) {
            console.error('[Groups] Erro ao salvar grupos em batch:', err);
          }
        }

        totalProcessed += batch.length;
        batchCount++; // ✅ NOVO: Incrementa contador de batches

        // Report progress (não sabemos total ainda no streaming)
        onProgress?.({
          phase: 'indexing',
          current: totalProcessed,
          total: totalProcessed, // Total estimado = processado até agora
          percentage: 0, // Indeterminado em streaming
          message: `Processando... ${totalProcessed} itens`,
        });

        // Limpa batch
        batch = [];

        // ✅ NOVO: Force GC a cada N batches para liberar memória
        if (batchCount % GC_INTERVAL === 0) {
          if (globalThis.gc) {
            globalThis.gc();
            console.log(`[BatchProcessor] GC forçado após ${batchCount} batches`);
          }
          // Yield extra para dar tempo ao GC
          await new Promise((resolve) => setTimeout(resolve, 10));
        } else {
          // Yield normal para UI atualizar (evita bloquear thread)
          await new Promise((resolve) => setTimeout(resolve, YIELD_INTERVAL));
        }
      }
    }

    // Processa últimos itens do batch (se houver)
    if (batch.length > 0) {
      // ✅ FASE OTIMIZAÇÃO: Filtra URLs inválidas antes de processar
      const validBatch = batch.filter((item) => {
        const isValid = isValidStreamURL(item.url);
        if (!isValid) {
          console.warn(`[BatchProcessor] URL inválida rejeitada (final batch): ${item.name} (${item.url.substring(0, 50)}...)`);
        }
        return isValid;
      });

      const dbItems: M3UItem[] = validBatch.map((item) => {
        // ✅ NOVO: Extrai seriesId para items de séries (mesmo código do batch principal)
        const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);
        let seriesId: string | undefined;
        let seasonNumber: number | undefined;
        let episodeNumber: number | undefined;

        if (seriesInfo && item.mediaKind === 'series') {
          const normalized = normalizeSeriesName(seriesInfo.seriesName);
          const seriesKey = createSeriesKey(normalized, item.group, item.parsedTitle.year);
          seriesId = `${playlistId}_${seriesKey}`;
          seasonNumber = seriesInfo.season;
          episodeNumber = seriesInfo.episode;
        }

        return {
          id: `${playlistId}_${item.id}`,
          playlistId,
          name: item.name,
          url: item.url,
          logo: item.logo,
          group: item.group,
          mediaKind: item.mediaKind,
          title: item.parsedTitle.title,
          titleNormalized: normalizeTitle(item.parsedTitle.title || item.name),  // ✅ FASE OTIMIZAÇÃO
          groupNormalized: normalizeGroup(item.group),                          // ✅ FASE OTIMIZAÇÃO
          urlHash: hashURL(item.url),                                           // ✅ FASE OTIMIZAÇÃO
          year: item.parsedTitle.year,
          season: item.parsedTitle.season,
          episode: item.parsedTitle.episode,
          quality: item.parsedTitle.quality,
          epgId: item.epgId,
          seriesId,        // ✅ NOVO
          seasonNumber,    // ✅ NOVO
          episodeNumber,   // ✅ NOVO
          createdAt: Date.now(),
        };
      });

      try {
        await db.items.bulkAdd(dbItems);
      } catch (error) {
        console.warn('[BatchProcessor] bulkAdd falhou no último batch, usando bulkPut:', (error as Error).message);

        try {
          await db.items.bulkPut(dbItems);
          console.log('[BatchProcessor] ✓ Último batch salvo via bulkPut (upsert)');
        } catch (putError) {
          console.error('[BatchProcessor] ❌ ERRO no último batch', {
            batchSize: dbItems.length,
            error: (putError as Error).message,
          });

          // Última tentativa: item por item
          let savedCount = 0;
          for (const item of dbItems) {
            try {
              await db.items.put(item);
              savedCount++;
            } catch {
              console.error('[BatchProcessor] Item rejeitado:', item.id);
            }
          }

          console.warn(`[BatchProcessor] Último batch: ${savedCount}/${dbItems.length} salvos`);
        }
      }

      totalProcessed += batch.length;

      // ✅ RLE: Flush final do currentSeriesRun se houver
      if (currentSeriesRun) {
        await flushSeriesRun(currentSeriesRun, playlistId);
        currentSeriesRun = null;
      }

      // ✅ FIX: Flush final de groups (último batch)
      if (groupsMap.size > 0) {
        const dbGroups = Array.from(groupsMap.values()).map((group) => ({
          id: `${playlistId}_${group.id}`,
          playlistId,
          name: group.name,
          mediaKind: group.mediaKind,
          itemCount: group.itemCount,
          logo: group.logo,
          createdAt: Date.now(),
        }));

        try {
          await db.groups.bulkPut(dbGroups);
          console.log(`[Groups] ✅ ${dbGroups.length} grupos salvos/atualizados (último batch)`);
        } catch (err) {
          console.error('[Groups] Erro ao salvar grupos no último batch:', err);
        }
      }
    }

    // Finaliza grupos
    const groups = Array.from(groupsMap.values());
    stats.groupCount = groups.length;

    // ✅ Grupos já foram salvos incrementalmente durante batches, mas mantém
    // este código final como fallback/validação
    const dbGroups = groups.map((group) => ({
      id: `${playlistId}_${group.id}`,
      playlistId,
      name: group.name,
      mediaKind: group.mediaKind,
      itemCount: group.itemCount,
      logo: group.logo,
      createdAt: Date.now(),
    }));

    if (dbGroups.length > 0) {
      try {
        // ✅ Use bulkPut diretamente (grupos já foram criados incrementalmente)
        await db.groups.bulkPut(dbGroups);
        console.log('[BatchProcessor] ✓ Validação final: grupos salvos/atualizados');
      } catch (putError) {
        console.error('[BatchProcessor] Erro na validação final de grupos:', (putError as Error).message);
        // Groups são menos críticos, pode continuar
      }
    }

    // Progress final
    onProgress?.({
      phase: 'complete',
      current: totalProcessed,
      total: totalProcessed,
      percentage: 100,
      message: `Concluído! ${stats.totalItems} itens processados.`,
    });

    // ✅ NOVO: Converte Set para array no seriesGroups
    const seriesGroupsArray: SeriesGroup[] = Array.from(seriesGroupsMap.values()).map(group => ({
      ...group,
      seasons: group.seasons, // Mantém como Set por enquanto (será usado no fuzzy merge)
    }));

    // DEBUG: Log stats
    console.log('[BatchProcessor] ===== STATS FINAIS =====');
    console.log(`[BatchProcessor] Total Items: ${stats.totalItems}`);
    console.log(`[BatchProcessor] Movies: ${stats.movieCount}`);
    console.log(`[BatchProcessor] Series: ${stats.seriesCount}`);
    console.log(`[BatchProcessor] Live: ${stats.liveCount}`);
    console.log(`[BatchProcessor] Unknown: ${stats.unknownCount}`);
    console.log(`[BatchProcessor] Groups: ${stats.groupCount}`);
    console.log(`[BatchProcessor] Series Groups: ${seriesGroupsArray.length}`); // ✅ NOVO

    return {
      items: [], // Items já foram inseridos no DB - não retornamos para economizar memória
      groups,
      stats,
      seriesGroups: seriesGroupsArray, // ✅ NOVO: Retorna series groups para fuzzy merge
    };
  } catch (error) {
    onProgress?.({
      phase: 'error',
      current: totalProcessed,
      total: totalProcessed,
      percentage: 0,
      message: `Erro no processamento: ${(error as Error).message}`,
    });
    throw error;
  }
}

export default { processBatches };
