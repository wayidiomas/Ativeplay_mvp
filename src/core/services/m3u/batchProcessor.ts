/**
 * Batch Processor
 * Processa itens do streaming parser em lotes, mantendo UI responsiva
 * FASE 1: Adiciona series grouping híbrido (hash-based durante streaming)
 */

import { db, type M3UItem } from '@core/db/schema';
import { ContentClassifier } from './classifier';
import { normalizeSeriesName, createSeriesKey } from './utils';
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

// ✅ FASE 7.1: Callback para navegação antecipada (após primeiros items)
export type EarlyReadyCallback = (stats: {
  itemsLoaded: number;
  liveCount: number;
  movieCount: number;
  seriesCount: number;
}) => void | Promise<void>;

const YIELD_INTERVAL = 0; // Yield para UI (setTimeout 0ms)
const EARLY_NAV_THRESHOLD = 500; // ✅ FASE 7.1: Navega após 500 items carregados

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
 * Processa itens do stream em lotes e insere no banco
 * FASE 1: Adiciona series grouping incremental (hash-based)
 * FASE 7.1: Adiciona early navigation callback
 *
 * @param generator AsyncGenerator que produz itens parseados
 * @param playlistId ID da playlist
 * @param onProgress Callback de progresso
 * @param onEarlyReady Callback disparado ao atingir threshold (500 items)
 * @returns Playlist completa com stats, grupos e seriesGroups
 */
export async function processBatches(
  generator: AsyncGenerator<M3UParsedItem>,
  playlistId: string,
  onProgress?: ProgressCallback,
  onEarlyReady?: EarlyReadyCallback
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
  let earlyReadyFired = false; // ✅ FASE 7.1: Controla disparo único do early callback

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

      // ✅ NOVO: Series grouping incremental (hash-based)
      if (item.mediaKind === 'series' && item.parsedTitle?.season) {
        const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);

        if (seriesInfo) {
          // Normaliza nome (remove tags, anos, qualidade, etc)
          const normalized = normalizeSeriesName(seriesInfo.seriesName);
          const seriesKey = createSeriesKey(normalized);

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
      }

      // Processa batch quando atingir tamanho limite
      if (batch.length >= BATCH_SIZE) {
        // Prepara itens para inserção no DB
        const dbItems: M3UItem[] = batch.map((item) => {
          // ✅ NOVO: Extrai seriesId para items de séries
          const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);
          let seriesId: string | undefined;
          let seasonNumber: number | undefined;
          let episodeNumber: number | undefined;

          if (seriesInfo && item.mediaKind === 'series') {
            const normalized = normalizeSeriesName(seriesInfo.seriesName);
            seriesId = createSeriesKey(normalized);
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

        totalProcessed += batch.length;
        batchCount++; // ✅ NOVO: Incrementa contador de batches

        // ✅ FASE 7.1: Dispara early ready callback após threshold
        if (!earlyReadyFired && totalProcessed >= EARLY_NAV_THRESHOLD && onEarlyReady) {
          earlyReadyFired = true;
          console.log(`[BatchProcessor] ✅ EARLY READY! ${totalProcessed} items carregados, disparando callback...`);

          try {
            await onEarlyReady({
              itemsLoaded: totalProcessed,
              liveCount: stats.liveCount,
              movieCount: stats.movieCount,
              seriesCount: stats.seriesCount,
            });
          } catch (err) {
            console.error('[BatchProcessor] Erro no onEarlyReady callback:', err);
            // Não interrompe o parsing se callback falhar
          }
        }

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
      const dbItems: M3UItem[] = batch.map((item) => {
        // ✅ NOVO: Extrai seriesId para items de séries (mesmo código do batch principal)
        const seriesInfo = ContentClassifier.extractSeriesInfo(item.name);
        let seriesId: string | undefined;
        let seasonNumber: number | undefined;
        let episodeNumber: number | undefined;

        if (seriesInfo && item.mediaKind === 'series') {
          const normalized = normalizeSeriesName(seriesInfo.seriesName);
          seriesId = createSeriesKey(normalized);
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
    }

    // Finaliza grupos
    const groups = Array.from(groupsMap.values());
    stats.groupCount = groups.length;

    // Salva grupos no DB
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
        await db.groups.bulkAdd(dbGroups);
      } catch (error) {
        console.warn('[BatchProcessor] bulkAdd de grupos falhou, usando bulkPut:', (error as Error).message);

        try {
          await db.groups.bulkPut(dbGroups);
          console.log('[BatchProcessor] ✓ Grupos salvos via bulkPut (upsert)');
        } catch (putError) {
          console.error('[BatchProcessor] Erro ao salvar grupos:', (putError as Error).message);
          // Groups são menos críticos, pode continuar
        }
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
