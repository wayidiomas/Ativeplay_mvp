/**
 * Database Operations
 * Operacoes de alto nivel para gerenciar playlists e conteudo
 */

import { db, type Playlist, type M3UItem, type M3UGroup, type Series } from './schema';
import type { ProgressCallback } from '../services/m3u';
import { ContentClassifier } from '../services/m3u/classifier';

const MAX_PLAYLISTS = parseInt(import.meta.env.VITE_MAX_PLAYLISTS || '3', 10);
const SERVER_URL = import.meta.env.VITE_BRIDGE_URL;

// ✅ Lock em memória para prevenir race conditions (React StrictMode executa effects 2x)
const processingUrls = new Map<string, Promise<string>>();

/**
 * Faz polling do status de um job até completar
 */
async function pollJobUntilComplete(
  jobId: string,
  onProgress?: ProgressCallback,
  hash?: string, // Hash da playlist para polling incremental
  playlistId?: string
): Promise<{ hash: string; stats: any; groups: any[] }> {
  const maxAttempts = 80; // ~30 minutos com backoff até 30s
  const initialInterval = 2000; // Start at 2s
  const maxInterval = 30000; // Cap at 30s
  const backoffMultiplier = 1.5; // Exponential factor
  let attempts = 0;
  let previewLoaded = false;

  while (attempts < maxAttempts) {
    attempts++;

    // Exponential backoff: 2s → 3s → 4.5s → 6.75s → ... → 30s (capped)
    const pollInterval = Math.min(
      initialInterval * Math.pow(backoffMultiplier, attempts - 1),
      maxInterval
    );

    try {
      const response = await fetch(`${SERVER_URL}/api/jobs/${jobId}`, {
        signal: AbortSignal.timeout(10000), // 10s timeout para cada poll
      });

      if (!response.ok) {
        // ✅ FALLBACK: Se job não existe mas temos hash, usa endpoint alternativo
        if (response.status === 404 && hash) {
          console.log('[Poll] Job 404, usando fallback para /api/playlist/progress/:hash');
          const progressResult = await pollProgressAndSyncIncremental(hash, playlistId, onProgress);

          if (progressResult.status === 'completed') {
            // Busca dados finais do meta.json
            const metaResp = await fetch(`${SERVER_URL}/api/playlist/progress/${hash}`);
            const metaData = await metaResp.json();
            return {
              hash,
              stats: metaData.progress,
              groups: progressResult.groups,
            };
          }

          // Ainda em progresso, aguarda e continua polling
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        if (response.status === 404) {
          throw new Error('Job não encontrado (pode ter expirado)');
        }
        throw new Error(`Erro ao verificar status do job (${response.status})`);
      }

      const jobStatus = await response.json();

      // Early Navigation: polling incremental para sincronizar grupos durante parsing
      if (hash && jobStatus.status === 'active') {
        pollProgressAndSyncIncremental(hash, playlistId, onProgress).catch(err =>
          console.warn('[Early Nav] Erro no polling incremental:', err)
        );
        if (!previewLoaded && playlistId) {
          previewLoaded = true;
          loadPreviewItems(hash, playlistId).catch(err => {
            previewLoaded = false; // permite retentar
            console.warn('[Early Nav] Erro ao carregar preview:', err);
          });
        }
      }

      // Job completado com sucesso
      if (jobStatus.status === 'completed') {
        return {
          hash: jobStatus.data.hash,
          stats: jobStatus.data.stats,
          groups: jobStatus.data.groups,
        };
      }

      // Job falhou
      if (jobStatus.status === 'failed') {
        throw new Error(`Erro ao processar playlist: ${jobStatus.error || 'Erro desconhecido'}`);
      }

      // Job ainda processando - atualiza progresso
      const workerProgress = typeof jobStatus.progress === 'object'
        ? jobStatus.progress?.percentage
        : typeof jobStatus.progress === 'number'
          ? jobStatus.progress
          : 0;

      const percentage = Math.min(80, workerProgress || 0);
      const statusMessages: Record<string, string> = {
        waiting: `Aguardando na fila (posição ${jobStatus.queuePosition || '?'})...`,
        active: 'Processando playlist...',
        delayed: 'Processamento atrasado...',
      };

      onProgress?.({
        phase: 'downloading',
        current: percentage,
        total: 100,
        percentage,
        message: statusMessages[jobStatus.status] || 'Processando...',
      });

      // Aguarda antes do próximo poll (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      // Se for timeout ou erro de rede, tenta novamente
      if (attempts >= maxAttempts) {
        throw new Error('Timeout ao processar playlist. Tente novamente.');
      }
      // Aguarda antes de retentar (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('Timeout ao processar playlist após 10 minutos');
}

/**
 * Polling incremental: verifica progresso e sincroniza grupos conforme ficam disponíveis
 * Permite early navigation enquanto parsing ainda está em andamento
 */
async function pollProgressAndSyncIncremental(
  hash: string,
  playlistId?: string,
  onProgress?: ProgressCallback
): Promise<{ groups: M3UGroup[]; status: 'in_progress' | 'completed' }> {
  try {
    const response = await fetch(`${SERVER_URL}/api/playlist/progress/${hash}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { groups: [], status: 'in_progress' };
      }
      throw new Error(`Erro ao verificar progresso (${response.status})`);
    }

    const progressData = await response.json();

    // Atualiza progresso na UI
    const percentage = progressData.status === 'completed'
      ? 100
      : Math.min(
        80,
        progressData.progress?.percentage ??
        (progressData.progress?.totalItems ? 20 : 5) // fallback conservador
      );

    onProgress?.({
      phase: progressData.status === 'completed' ? 'parsing' : 'downloading',
      current: percentage,
      total: 100,
      percentage,
      message: progressData.status === 'completed'
        ? 'Parsing completo! Sincronizando...'
        : `Parsing em andamento (${progressData.progress?.totalItems || 0} items)...`,
    });

    // Sincroniza grupos disponíveis no Dexie
    if (progressData.groups && progressData.groups.length > 0) {
      const groupsToSync: M3UGroup[] = progressData.groups.map((g: any) => ({
        id: g.id,
        playlistId: playlistId || hash,
        name: g.name,
        mediaKind: g.mediaKind as 'live' | 'movie' | 'series' | 'unknown',
        itemCount: g.itemCount,
        logo: g.logo,
        createdAt: Date.now(),
      }));

      await db.groups.bulkPut(groupsToSync);

      return {
        groups: groupsToSync,
        status: progressData.status === 'completed' ? 'completed' : 'in_progress',
      };
    }

    return {
      groups: [],
      status: progressData.status === 'completed' ? 'completed' : 'in_progress',
    };
  } catch (error) {
    console.warn('[Progress Poll] Erro:', error);
    return { groups: [], status: 'in_progress' };
  }
}

/**
 * Carrega preview inicial de itens (primeiros N) mesmo com parsing em andamento.
 */
async function loadPreviewItems(hash: string, playlistId: string, limit = 500): Promise<void> {
  try {
    const resp = await fetch(`${SERVER_URL}/api/playlist/items/${hash}/preview?limit=${limit}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const items = (data.items || []).map((item: any) => {
      const title = item.parsedTitle?.title || item.title || item.name;
      return {
        id: `${playlistId}_${item.id}`,
        playlistId,
        name: item.name,
        url: item.url,
        logo: item.logo,
        group: item.group,
        mediaKind: item.mediaKind,
        title,
        titleNormalized: (title || '').toUpperCase(),
        year: item.parsedTitle?.year || item.year,
        season: item.parsedTitle?.season || item.season,
        episode: item.parsedTitle?.episode || item.episode,
        quality: item.parsedTitle?.quality || item.quality,
        epgId: item.epgId,
        createdAt: Date.now(),
      } as M3UItem;
    });
    if (items.length > 0) {
      await db.items.bulkPut(items);
    }
  } catch (error) {
    console.warn('[Preview] Falha ao carregar preview:', error);
  }
}

/**
 * Processa M3U usando servidor com Worker Pool architecture
 * - Cache hit: retorna imediatamente
 * - Cache miss: faz polling até job completar
 */
async function fetchFromServer(
  url: string,
  onProgress?: ProgressCallback,
  playlistId?: string
): Promise<{ hash: string; stats: any; groups: any[] }> {
  // Validação: servidor deve estar configurado
  if (!SERVER_URL) {
    throw new Error('Servidor não configurado. Configure VITE_BRIDGE_URL no .env');
  }

  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Conectando ao servidor...',
  });

  try {
    // 1. Envia request para servidor (pode retornar cache OU jobId)
    onProgress?.({
      phase: 'downloading',
      current: 5,
      total: 100,
      percentage: 5,
      message: 'Verificando cache...',
    });

    const parseResponse = await fetch(`${SERVER_URL}/api/playlist/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: {
          includeGroups: true,
          normalize: true,
          removeDuplicates: true,
        },
      }),
      signal: AbortSignal.timeout(30000), // 30s timeout (só para request inicial)
    });

    if (!parseResponse.ok) {
      const errorText = await parseResponse.text();
      throw new Error(`Erro do servidor (${parseResponse.status}): ${errorText}`);
    }

    const parseResult = await parseResponse.json();

    if (!parseResult.success) {
      throw new Error(parseResult.error || 'Erro ao processar playlist no servidor');
    }

    let hash: string;
    let stats: any;
    let groups: any[];

    // Cache hit → dados retornados imediatamente
    if (parseResult.cached) {
      hash = parseResult.hash;
      stats = parseResult.data.stats;
      groups = parseResult.data.groups;
    }
    // Job enfileirado → faz polling até completar
    else if (parseResult.queued) {
      const jobId = parseResult.jobId;
      hash = parseResult.hash; // Hash disponível imediatamente para early navigation

      onProgress?.({
        phase: 'downloading',
        current: 10,
        total: 100,
        percentage: 10,
        message: 'Processando playlist (aguardando na fila)...',
      });

      // Polling até job completar (com early navigation via hash)
      const jobResult = await pollJobUntilComplete(jobId, onProgress, hash, playlistId);

      stats = jobResult.stats;
      groups = jobResult.groups;

      onProgress?.({
        phase: 'downloading',
        current: 50,
        total: 100,
        percentage: 50,
        message: 'Processamento completo! Sincronizando itens em segundo plano...',
      });
    } else {
      throw new Error('Resposta inesperada do servidor');
    }
    return { hash, stats, groups };

  } catch (error) {
    // Erro específico: mostra mensagem clara ao usuário
    const errorMessage = error instanceof Error
      ? error.message
      : 'Erro desconhecido ao processar playlist';

    console.error('[Server] Erro ao processar playlist:', errorMessage);

    onProgress?.({
      phase: 'error',
      current: 0,
      total: 100,
      percentage: 0,
      message: errorMessage,
    });

    throw new Error(`Falha no servidor: ${errorMessage}`);
  }
}

/**
 * Aguarda um job completar (versão simplificada para fallback de 404)
 * Retorna quando job está 'completed' ou lança erro se falhar/timeout
 */
async function waitForJobCompletion(jobId: string, maxWait = 1800000): Promise<void> { // 30 minutos
  const startTime = Date.now();
  const pollInterval = 2000; // 2s

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(`${SERVER_URL}/api/jobs/${jobId}`);

      if (!response.ok) {
        throw new Error(`Erro ao verificar job: ${response.status}`);
      }

      const job = await response.json();

      if (job.status === 'completed') {
        console.log('[DB DEBUG] Job completado:', jobId);
        return;
      }

      if (job.status === 'failed') {
        throw new Error('Job falhou no servidor');
      }

      // Aguarda antes de tentar novamente
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      // Se for último attempt, lança erro
      if (Date.now() - startTime >= maxWait) {
        throw new Error('Timeout aguardando processamento');
      }
      // Aguarda antes de retentar
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('Timeout aguardando processamento');
}

/**
 * ✅ RETRY LOGIC: Faz fetch com retry automático e exponential backoff
 * Tenta até maxRetries vezes antes de falhar
 */
async function fetchWithRetry(url: string, init?: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(30000), // 30s timeout padrão
      });

      // Sucesso - retorna imediatamente
      if (response.ok) {
        return response;
      }

      // 404 (cache expirado) não faz retry - deixa código chamador lidar
      if (response.status === 404) {
        return response;
      }

      // Outros erros HTTP: retry
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      console.warn(`[RETRY] Tentativa ${attempt + 1}/${maxRetries} falhou (${response.status})`);

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[RETRY] Tentativa ${attempt + 1}/${maxRetries} falhou:`, lastError.message);

      // Se for último attempt, lança erro
      if (attempt === maxRetries - 1) {
        throw lastError;
      }

      // Aguarda antes de retry (exponential backoff: 1s, 2s, 4s...)
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
      console.log(`[RETRY] Aguardando ${delay}ms antes de retentar...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError || new Error('Falha após múltiplas tentativas');
}

/**
 * Sincroniza itens paginados do servidor e insere no Dexie
 * Pode ser usado em background (fire-and-forget) ou aguardado em refresh
 *
 * @param options.loadPartial - Se true, carrega apenas os primeiros N items (early navigation)
 * @param options.partialLimit - Quantidade de items para carregar no modo partial (padrão: 1000)
 * @returns Informações sobre o carregamento (partial, loaded, total)
 */
async function syncItemsFromServer(
  hash: string,
  playlistId: string,
  onProgress?: ProgressCallback,
  options?: { loadPartial?: boolean; partialLimit?: number }
): Promise<{ partial: boolean; loaded: number; total: number }> {
  if (!SERVER_URL) {
    throw new Error('Servidor não configurado. Configure VITE_BRIDGE_URL no .env');
  }

  const batchSize = 500; // Increased from 100 for better performance
  let total = 0;
  let processed = 0;

  // MODO PARTIAL: Carrega apenas primeiros N items para early navigation
  if (options?.loadPartial) {
    const partialLimit = options.partialLimit || 500;

    // ✅ Usa fetchWithRetry para robustez
    const itemsResponse = await fetchWithRetry(
      `${SERVER_URL}/api/playlist/items/${hash}/partial?limit=${partialLimit}`
    );

    // FALLBACK: Cache expirado (404) → reprocessa playlist
    if (itemsResponse.status === 404) {
      console.warn(`[DB DEBUG] Cache expirado (404). Reprocessando playlist...`);

      const playlist = await db.playlists.get(playlistId);
      if (!playlist) throw new Error('Playlist não encontrada');

      // Solicita reprocessamento no servidor
      const parseResponse = await fetch(`${SERVER_URL}/api/playlist/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: playlist.url }),
      });

      const parseData = await parseResponse.json();
      const newHash = parseData.hash;

      // Atualiza hash no banco
      await db.playlists.update(playlistId, { hash: newHash });
      console.log('[DB DEBUG] Novo hash salvo:', newHash);

      // Aguarda job completar
      if (parseData.queued) {
        await waitForJobCompletion(parseData.jobId);
        // Aguarda 1s adicional para garantir que cache foi salvo no disco
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Recomeça sync com novo hash (RECURSÃO)
      return syncItemsFromServer(newHash, playlistId, onProgress, options);
    }

    if (!itemsResponse.ok) {
      throw new Error(`Erro ao buscar itens parciais: ${itemsResponse.status}`);
    }

    const page = await itemsResponse.json();
    const items = page.items || [];
    total = page.total || 0;

    // ✅ Dedup efêmero para partial load
    const seenUrls = new Set<string>();
    const uniqueItems = items.filter((item: any) => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    });

    console.log('[DB DEBUG] Partial load processado', {
      total: items.length,
      unique: uniqueItems.length,
      duplicates: items.length - uniqueItems.length,
    });

    const dbItems: M3UItem[] = uniqueItems.map((item: any) => {
      const title = item.parsedTitle?.title || item.title || item.name;
      return {
        id: `${playlistId}_${item.id}`,
        playlistId,
        name: item.name,
        url: item.url,
        logo: item.logo,
        group: item.group,
        mediaKind: item.mediaKind,
        title,
        titleNormalized: (title || '').toUpperCase(), // Para busca otimizada
        year: item.parsedTitle?.year || item.year,
        season: item.parsedTitle?.season || item.season,
        episode: item.parsedTitle?.episode || item.episode,
        quality: item.parsedTitle?.quality || item.quality,
        epgId: item.epgId,
        xuiId: item.xuiId,
        createdAt: Date.now(),
      };
    });

    // Insere em batches
    for (let i = 0; i < dbItems.length; i += batchSize) {
      const batch = dbItems.slice(i, i + batchSize);
      // bulkPut faz upsert (update or insert) - evita erro se item já existe
      await db.items.bulkPut(batch);
    }

    processed = uniqueItems.length; // ✅ Conta apenas únicos

    // Libera memória do Set
    seenUrls.clear();

    onProgress?.({
      phase: 'indexing',
      current: processed,
      total,
      percentage: Math.min(100, Math.round((processed / total) * 100)),
      message: `Carregados primeiros ${processed} itens...`,
    });

    return { partial: true, loaded: processed, total };
  }

  // MODO COMPLETO: Carrega todos os items com paginação PARALELA
  const pageSize = 5000;
  const parallelFetches = 5; // Fetch 5 pages in parallel
  let offset = 0;

  // ✅ DEDUP EFÊMERO (liberado ao final da função)
  const seenUrls = new Set<string>();
  let duplicatesSkipped = 0;

  // Helper: Process and insert a single page
  const processPage = (page: any) => {
    const items = page.items || [];
    if (items.length === 0) return { dbItems: [], itemsCount: 0 };

    // ✅ FILTRAR DUPLICATAS ANTES DE INSERIR
    const uniqueItems = items.filter((item: any) => {
      if (seenUrls.has(item.url)) {
        duplicatesSkipped++;
        return false; // Pula duplicata
      }
      seenUrls.add(item.url);
      return true;
    });

    const dbItems: M3UItem[] = uniqueItems.map((item: any) => {
      const title = item.parsedTitle?.title || item.title || item.name;
      return {
        id: `${playlistId}_${item.id}`,
        playlistId,
        name: item.name,
        url: item.url,
        logo: item.logo,
        group: item.group,
        mediaKind: item.mediaKind,
        title,
        titleNormalized: (title || '').toUpperCase(),
        year: item.parsedTitle?.year || item.year,
        season: item.parsedTitle?.season || item.season,
        episode: item.parsedTitle?.episode || item.episode,
        quality: item.parsedTitle?.quality || item.quality,
        epgId: item.epgId,
        xuiId: item.xuiId,
        createdAt: Date.now(),
      };
    });

    return { dbItems, itemsCount: items.length };
  };

  // Fetch first page to get total count
  const firstResponse = await fetchWithRetry(
    `${SERVER_URL}/api/playlist/items/${hash}?limit=${pageSize}&offset=0`
  );

  if (firstResponse.status === 404) {
    // Handle cache expiry (same as before)
    console.warn('[DB DEBUG] Cache expirado. Reprocessando...');
    const playlist = await db.playlists.get(playlistId);
    if (!playlist) throw new Error('Playlist não encontrada');
    const parseResponse = await fetch(`${SERVER_URL}/api/playlist/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: playlist.url }),
    });
    const parseData = await parseResponse.json();
    await db.playlists.update(playlistId, { hash: parseData.hash });
    if (parseData.queued) {
      await waitForJobCompletion(parseData.jobId);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return syncItemsFromServer(parseData.hash, playlistId, onProgress, { loadPartial: false });
  }

  if (!firstResponse.ok) {
    throw new Error(`Erro ao buscar itens: ${firstResponse.status}`);
  }

  const firstPage = await firstResponse.json();
  total = firstPage.total || 0;

  // Process and insert first page
  const { dbItems: firstDbItems, itemsCount: firstCount } = processPage(firstPage);
  for (let i = 0; i < firstDbItems.length; i += batchSize) {
    const batch = firstDbItems.slice(i, i + batchSize);
    await db.items.bulkPut(batch);
  }
  processed += firstCount;
  offset = pageSize;

  // Parallel fetch remaining pages
  while (offset < total) {
    // Calculate how many pages to fetch in parallel
    const fetchPromises = [];
    for (let i = 0; i < parallelFetches && offset < total; i++) {
      const currentOffset = offset + (i * pageSize);
      fetchPromises.push(
        fetchWithRetry(`${SERVER_URL}/api/playlist/items/${hash}?limit=${pageSize}&offset=${currentOffset}`)
          .then(res => res.ok ? res.json() : null)
      );
    }

    // Wait for all parallel fetches to complete
    const pages = await Promise.all(fetchPromises);

    // Insert pages serially (to avoid Dexie lock contention)
    for (const page of pages) {
      if (!page) continue;

      const { dbItems, itemsCount } = processPage(page);

      // Insert in sub-batches
      for (let i = 0; i < dbItems.length; i += batchSize) {
        const batch = dbItems.slice(i, i + batchSize);
        await db.items.bulkPut(batch);
      }

      processed += itemsCount;

      const percentage = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
      onProgress?.({
        phase: 'indexing',
        current: processed,
        total,
        percentage,
        message: `Sincronizando itens... (${processed}/${total})`,
      });
    }

    offset += parallelFetches * pageSize;

    if (processed >= total) break;
  }

  // ✅ LIBERA MEMÓRIA DO SET
  seenUrls.clear();
  console.log('[DB DEBUG] ✓ Sync completo. Memória de dedup liberada.', {
    totalProcessed: processed,
    totalDuplicatesSkipped: duplicatesSkipped,
  });

  onProgress?.({
    phase: 'complete',
    current: processed,
    total: total || processed,
    percentage: 100,
    message: 'Itens sincronizados',
  });

  return { partial: false, loaded: processed, total };
}

/**
 * Continua sincronização completa em background após early navigation
 * Aguarda 1s antes de começar (para UI se estabilizar)
 * Atualiza lastSyncStatus conforme progresso
 *
 * ✅ LOGS PERSISTENTES: Salva logs no localStorage para inspeção mesmo sem console
 */
/**
 * Agrupa episódios de séries e salva no banco
 * Chamado após sincronização completa de itens
 */
/**
 * Agrupa episódios de séries e salva no banco
 * Chamado após sincronização completa de itens
 */
async function groupAndSaveSeries(playlistId: string): Promise<void> {
  // Agrupamento streaming/chunked para evitar OOM em playlists grandes
  // Chunk maior: processamento de séries é leve em memória, então aumentamos o batch
  const BATCH_SIZE = 50000;
  let offset = 0;

  const seriesMap = new Map<
    string,
    {
      id: string;
      name: string;
      logo: string;
      group: string;
      totalEpisodes: number;
      seasons: Set<number>;
      firstEpisode: number;
      lastEpisode: number;
      firstSeason: number;
      lastSeason: number;
    }
  >();

  // Helper para criar sérieId/slug
  // Usa hash do nome completo para garantir unicidade mesmo com nomes longos
  const createSeriesId = (seriesName: string) => {
    const slug = seriesName
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50); // Reduzido para deixar espaço para hash

    // Adiciona hash simples do nome completo para garantir unicidade
    const hash = Math.abs(
      seriesName.split('').reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0);
      }, 0)
    ).toString(36).substring(0, 8);

    return `series_${playlistId}_${slug}_${hash}`;
  };

  // Helper para chave de agrupamento (nome base)
  const normalizeSeriesKey = (name: string) =>
    name
      .toLowerCase()
      .replace(/\s+S\d{1,2}E\d{1,2}.*/i, '')
      .replace(/\s+\d{1,2}x\d{1,2}.*/i, '')
      .replace(/\s+T\d{1,2}E\d{1,2}.*/i, '')
      .replace(/\(\d{4}\)/g, '')
      .replace(/\[\d{4}\]/g, '')
      .replace(/\b(1080p|720p|4k|hd|fhd|uhd)\b/gi, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const totalSeriesItems = await db.items
    .where({ playlistId, mediaKind: 'series' })
    .count();

  if (totalSeriesItems === 0) {
    console.log('[DB DEBUG] Nenhum item de série encontrado para agrupar');
    return;
  }

  console.log(`[DB DEBUG] Agrupamento chunked de séries: ${totalSeriesItems} items`);

  // Processa em chunks
  while (true) {
    const batch = await db.items
      .where({ playlistId, mediaKind: 'series' })
      .offset(offset)
      .limit(BATCH_SIZE)
      .toArray();

    if (batch.length === 0) break;

    const itemsToUpdate: M3UItem[] = [];

    for (const item of batch) {
      const info = ContentClassifier.extractSeriesInfo(item.name);
      const seriesName = info?.seriesName || normalizeSeriesKey(item.name) || item.name;
      const seriesKey = normalizeSeriesKey(seriesName);
      const seasonNumber = info?.season ?? 0;
      const episodeNumber = info?.episode ?? 0;
      const seriesId = createSeriesId(seriesKey);

      // Atualiza agregados
      const existing = seriesMap.get(seriesKey);
      if (existing) {
        existing.totalEpisodes += 1;
        existing.seasons.add(seasonNumber);
        existing.firstEpisode = existing.firstEpisode === 0 ? episodeNumber : Math.min(existing.firstEpisode, episodeNumber);
        existing.lastEpisode = Math.max(existing.lastEpisode, episodeNumber);
        existing.firstSeason = existing.firstSeason === 0 ? seasonNumber : Math.min(existing.firstSeason, seasonNumber);
        existing.lastSeason = Math.max(existing.lastSeason, seasonNumber);
      } else {
        seriesMap.set(seriesKey, {
          id: seriesId,
          name: seriesName,
          logo: item.logo || '',
          group: item.group,
          totalEpisodes: 1,
          seasons: new Set([seasonNumber]),
          firstEpisode: episodeNumber,
          lastEpisode: episodeNumber,
          firstSeason: seasonNumber,
          lastSeason: seasonNumber,
        });
      }

      // Prepara item atualizado
      itemsToUpdate.push({
        ...item,
        seriesId,
        seasonNumber,
        episodeNumber,
      });
    }

    // Salva itens atualizados em lote
    if (itemsToUpdate.length > 0) {
      await db.items.bulkPut(itemsToUpdate);
    }

    offset += BATCH_SIZE;
    console.log(`[DB DEBUG] Chunk de séries processado: offset=${offset}`);
  }

  // Converte mapa para array de Series
  const seriesRecords: Series[] = Array.from(seriesMap.values()).map((entry) => ({
    id: entry.id,
    playlistId,
    name: entry.name,
    logo: entry.logo,
    group: entry.group,
    totalEpisodes: entry.totalEpisodes,
    totalSeasons: entry.seasons.size,
    firstEpisode: entry.firstEpisode,
    lastEpisode: entry.lastEpisode,
    firstSeason: entry.firstSeason,
    lastSeason: entry.lastSeason,
    createdAt: Date.now(),
  }));

  // Persist series records
  await db.transaction('rw', [db.series], async () => {
    await db.series.where('playlistId').equals(playlistId).delete();
    if (seriesRecords.length > 0) {
      await db.series.bulkAdd(seriesRecords);
    }
  });

  console.log(`[DB DEBUG] Séries salvas (chunked): ${seriesRecords.length}`);
}

async function continueBackgroundSync(
  hash: string,
  playlistId: string
): Promise<void> {
  const logKey = `sync_log_${playlistId}`;

  // ✅ LOG PERSISTENTE: Início
  try {
    localStorage.setItem(logKey, JSON.stringify({
      status: 'started',
      timestamp: Date.now(),
      timestampReadable: new Date().toISOString(),
    }));
  } catch (e) {
    // Ignora erro de localStorage (pode estar cheio ou bloqueado)
  }

  console.log('[DB DEBUG] ===== BACKGROUND SYNC: Iniciando em 1s =====');

  // Aguarda 1s para UI se estabilizar
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    // Carrega resto dos items com paginação completa
    console.log('[DB DEBUG] BACKGROUND SYNC: Carregando resto dos items...');

    // ✅ LOG PERSISTENTE: Em progresso
    try {
      localStorage.setItem(logKey, JSON.stringify({
        status: 'syncing',
        timestamp: Date.now(),
        timestampReadable: new Date().toISOString(),
      }));
    } catch (e) {
      // Ignora erro de localStorage
    }

    await syncItemsFromServer(hash, playlistId, undefined, { loadPartial: false });

    // Agrupa séries de forma chunked no frontend (memória controlada)
    await groupAndSaveSeries(playlistId);
    console.log('[DB DEBUG] BACKGROUND SYNC: Series grouping done (chunked)');

    // Atualiza status para 'success'
    await db.playlists.update(playlistId, { lastSyncStatus: 'success' });
    console.log('[DB DEBUG] BACKGROUND SYNC: Concluído com sucesso!');

    // ✅ LOG PERSISTENTE: Sucesso
    try {
      localStorage.setItem(logKey, JSON.stringify({
        status: 'success',
        timestamp: Date.now(),
        timestampReadable: new Date().toISOString(),
      }));
    } catch (e) {
      // Ignora erro de localStorage
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('[DB DEBUG] BACKGROUND SYNC: Erro durante sincronização:', error);

    // ✅ LOG PERSISTENTE: Erro
    try {
      localStorage.setItem(logKey, JSON.stringify({
        status: 'error',
        error: errorMsg,
        stack: errorStack,
        timestamp: Date.now(),
        timestampReadable: new Date().toISOString(),
      }));
    } catch (e) {
      // Ignora erro de localStorage
    }

    // ⚠️ ALERT VISUAL: Notifica usuário de erro crítico
    // Comentado por enquanto para não assustar usuário - podemos ativar se necessário
    // alert(`Erro ao sincronizar playlist: ${errorMsg}`);

    // Marca como erro
    await db.playlists.update(playlistId, { lastSyncStatus: 'error' });
  }
}

/**
 * Adiciona uma nova playlist a partir de uma URL
 * Usa APENAS o servidor para processar M3U (sem fallback client-side)
 */
export async function addPlaylist(
  url: string,
  name?: string,
  onProgress?: ProgressCallback
): Promise<string> {
  // ✅ LOCK: Previne race conditions (React StrictMode executa effects 2x)
  const processingPromise = processingUrls.get(url);
  if (processingPromise) {
    console.log('[DB DEBUG] ⚠️ URL já está sendo processada, reutilizando Promise existente');
    return processingPromise;
  }

  // Cria Promise e adiciona ao lock
  const promise = (async () => {
    try {
      // Verifica limite de playlists
      const playlistCount = await db.playlists.count();
      if (playlistCount >= MAX_PLAYLISTS) {
        throw new Error(`Limite de ${MAX_PLAYLISTS} playlists atingido`);
      }

      // Verifica se URL ja existe
      const existing = await db.playlists.where('url').equals(url).first();
      if (existing) {
        console.log('[DB DEBUG] Playlist já existe:', existing.id);

        // Verifica status de sincronização e items carregados
        const itemsCount = await db.items.where('playlistId').equals(existing.id).count();
        const totalItems = existing.itemCount;

        console.log('[DB DEBUG] Items carregados:', itemsCount, '/', totalItems);
        console.log('[DB DEBUG] Status atual:', existing.lastSyncStatus);

        // Case 1: Items completos mas status ainda 'syncing' → corrige status
        if (itemsCount >= totalItems && existing.lastSyncStatus === 'syncing') {
          console.log('[DB DEBUG] Corrigindo status para "success" (items já completos)');
          await db.playlists.update(existing.id, { lastSyncStatus: 'success' });
        }

        // Case 2: Items incompletos → reinicia sync (sem reprocessar!)
        else if (itemsCount < totalItems) {
          console.log('[DB DEBUG] Items incompletos, reiniciando sync...');

          // Se hash não existe (playlist antiga), busca do servidor
          let hash = existing.hash;
          if (!hash) {
            console.log('[DB DEBUG] Hash não existe, buscando do servidor...');
            const parsed = await fetchFromServer(existing.url, onProgress, existing.id);
            hash = parsed.hash;
            // Salva hash para próxima vez
            await db.playlists.update(existing.id, { hash });
          } else {
            console.log('[DB DEBUG] Usando hash armazenado:', hash);
          }

          // Atualiza status para syncing
          await db.playlists.update(existing.id, { lastSyncStatus: 'syncing' });

          // Se tem menos de 500 items, carrega parcial primeiro
          if (itemsCount < 500) {
            console.log('[DB DEBUG] Carregando primeiros 500 items...');
            await syncItemsFromServer(hash, existing.id, onProgress, {
              loadPartial: true,
              partialLimit: 500,
            });
          }

          // Continua sync completo em background
          continueBackgroundSync(hash, existing.id).catch((err) => {
            console.error('[DB DEBUG] Erro ao continuar sincronização em background:', err);
          });
        }

        // Ativa a playlist existente
        await setActivePlaylist(existing.id);

        return existing.id;
      }

      // Gera ID unico
      const playlistId = `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // APENAS SERVIDOR (sem fallback) - não bloqueia no download de itens
      const parsed = await fetchFromServer(url, onProgress, playlistId);

      // Determina se deve ser ativa (primeira playlist = ativa)
      const isFirst = playlistCount === 0;

      // DEBUG: Log antes de salvar
      console.log('[DB DEBUG] ===== SALVANDO PLAYLIST =====');
      console.log('[DB DEBUG] PlaylistId:', playlistId);
      console.log('[DB DEBUG] Groups a salvar:', parsed.groups.length);
      console.log('[DB DEBUG] Stats:', parsed.stats);

      // Salva no banco com status 'syncing' (early navigation)
      await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
        // Cria registro da playlist
        const playlist: Playlist = {
          id: playlistId,
          name: name || extractNameFromUrl(url),
          url,
          hash: parsed.hash, // Salva hash para reuso futuro
          isActive: isFirst ? 1 : 0,
          lastUpdated: Date.now(),
          lastSyncStatus: 'syncing', // Early navigation: marca como syncing
          itemCount: parsed.stats.totalItems,
          liveCount: parsed.stats.liveCount,
          movieCount: parsed.stats.movieCount,
          seriesCount: parsed.stats.seriesCount,
          createdAt: Date.now(),
        };
        console.log('[DB DEBUG] Playlist object:', playlist);
        await db.playlists.add(playlist);

        // Salva grupos (grupos sempre vêm no retorno)
        const groups: M3UGroup[] = parsed.groups.map((group: any) => ({
          id: `${playlistId}_${group.id}`,
          playlistId,
          name: group.name,
          mediaKind: group.mediaKind,
          itemCount: group.itemCount,
          logo: group.logo,
          createdAt: Date.now(),
        }));

        // Grupos podem já ter sido inseridos pelo streaming parser
        if (groups.length > 0) {
          try {
            await db.groups.bulkAdd(groups);
          } catch (error) {
            // Se erro de chave duplicada, ignora (grupos já foram inseridos)
            console.log('[DB DEBUG] Grupos já existem (inseridos pelo streaming parser)');
          }
        }

        console.log('[DB DEBUG] Transação completada com sucesso!');
      });

      // DEBUG: Verifica o que foi salvo
      const savedPlaylist = await db.playlists.get(playlistId);
      const savedGroupsCount = await db.groups.where('playlistId').equals(playlistId).count();
      console.log('[DB DEBUG] ===== VERIFICAÇÃO PÓS-SAVE =====');
      console.log('[DB DEBUG] Playlist salva:', savedPlaylist);
      console.log('[DB DEBUG] Groups salvos:', savedGroupsCount);

      // Verifica grupos por mediaKind (1 query consolidada vs 3 queries)
      const allGroups = await db.groups.where('playlistId').equals(playlistId).toArray();
      const counts = allGroups.reduce((acc, g) => {
        acc[g.mediaKind] = (acc[g.mediaKind] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const movieGroups = counts.movie || 0;
      const seriesGroups = counts.series || 0;
      const liveGroups = counts.live || 0;
      console.log('[DB DEBUG] Movie groups:', movieGroups);
      console.log('[DB DEBUG] Series groups:', seriesGroups);
      console.log('[DB DEBUG] Live groups:', liveGroups);

      // EARLY NAVIGATION: Carrega apenas primeiros 500 items
      console.log('[DB DEBUG] ===== EARLY NAVIGATION: Carregando primeiros 500 items =====');
      await syncItemsFromServer(parsed.hash, playlistId, onProgress, {
        loadPartial: true,
        partialLimit: 500,
      });

      const savedItemsCount = await db.items.where('playlistId').equals(playlistId).count();
      console.log('[DB DEBUG] Items salvos (parcial):', savedItemsCount);

      // Continua sincronização completa em background (fire-and-forget)
      continueBackgroundSync(parsed.hash, playlistId).catch((err) => {
        console.error('[DB DEBUG] Erro ao continuar sincronização em background:', err);
      });

      return playlistId;
    } finally {
      // ✅ Remove lock quando terminar (sucesso ou erro)
      processingUrls.delete(url);
    }
  })();

  // ✅ Adiciona ao Map antes de executar
  processingUrls.set(url, promise);

  return promise;
}

/**
 * Atualiza uma playlist existente (re-sincroniza)
 * Usa APENAS o servidor para re-processar M3U
 */
export async function refreshPlaylist(
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) {
    throw new Error('Playlist nao encontrada');
  }

  // Re-processa usando servidor (retorna stats/grupos/hash)
  const parsed = await fetchFromServer(playlist.url, onProgress, playlistId);

  await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
    // Remove itens e grupos antigos
    await db.items.where('playlistId').equals(playlistId).delete();
    await db.groups.where('playlistId').equals(playlistId).delete();

    // Atualiza playlist
    await db.playlists.update(playlistId, {
      lastUpdated: Date.now(),
      lastSyncStatus: 'success',
      itemCount: parsed.stats.totalItems,
      liveCount: parsed.stats.liveCount,
      movieCount: parsed.stats.movieCount,
      seriesCount: parsed.stats.seriesCount,
    });

    // Re-insere grupos
    const groups: M3UGroup[] = parsed.groups.map((group: any) => ({
      id: `${playlistId}_${group.id}`,
      playlistId,
      name: group.name,
      mediaKind: group.mediaKind,
      itemCount: group.itemCount,
      logo: group.logo,
      createdAt: Date.now(),
    }));

    if (groups.length > 0) {
      await db.groups.bulkAdd(groups);
    }
  });

  // Sincroniza itens (aqui aguardamos para garantir atualização completa)
  await syncItemsFromServer(parsed.hash, playlistId, onProgress);
}

/**
 * Lista todas as playlists
 */
export async function getAllPlaylists(): Promise<Playlist[]> {
  return db.playlists.toArray();
}

/**
 * Obtem playlist ativa
 */
export async function getActivePlaylist(): Promise<Playlist | undefined> {
  return db.playlists.where('isActive').equals(1).first();
}

/**
 * Define playlist ativa
 */
export async function setActivePlaylist(playlistId: string): Promise<void> {
  await db.transaction('rw', db.playlists, async () => {
    // Desativa todas
    await db.playlists.toCollection().modify({ isActive: 0 });
    // Ativa a selecionada
    await db.playlists.update(playlistId, { isActive: 1 });
  });
}

/**
 * Remove uma playlist e todos os dados associados
 */
export async function removePlaylist(playlistId: string): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) return;

  const wasActive = playlist.isActive === 1;

  await db.transaction('rw', [db.playlists, db.items, db.groups, db.favorites, db.watchProgress], async () => {
    // Remove dados
    await db.items.where('playlistId').equals(playlistId).delete();
    await db.groups.where('playlistId').equals(playlistId).delete();
    await db.favorites.where('playlistId').equals(playlistId).delete();
    await db.watchProgress.where('playlistId').equals(playlistId).delete();
    await db.playlists.delete(playlistId);

    // Se era ativa, ativa a proxima
    if (wasActive) {
      const next = await db.playlists.toCollection().first();
      if (next) {
        await db.playlists.update(next.id, { isActive: 1 });
      }
    }
  });
}

/**
 * Extrai nome da playlist a partir da URL
 */
function extractNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    return hostname.charAt(0).toUpperCase() + hostname.slice(1);
  } catch {
    return 'Minha Playlist';
  }
}

/**
 * Obtem estatisticas da playlist ativa
 */
export async function getActivePlaylistStats(): Promise<{
  movies: number;
  series: number;
  live: number;
  total: number;
} | null> {
  const playlist = await getActivePlaylist();
  if (!playlist) return null;

  return {
    movies: playlist.movieCount,
    series: playlist.seriesCount,
    live: playlist.liveCount,
    total: playlist.itemCount,
  };
}
