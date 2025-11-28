/**
 * Database Operations
 * Operacoes de alto nivel para gerenciar playlists e conteudo
 */

import { db, type Playlist, type M3UItem, type M3UGroup } from './schema';
import type { ProgressCallback } from '../services/m3u';

const MAX_PLAYLISTS = parseInt(import.meta.env.VITE_MAX_PLAYLISTS || '3', 10);
const SERVER_URL = import.meta.env.VITE_BRIDGE_URL;

/**
 * Processa M3U usando APENAS o servidor (SEM FALLBACK)
 * Se servidor falhar, lança erro
 */
async function fetchFromServer(
  url: string,
  onProgress?: ProgressCallback
): Promise<{ stats: any; groups: any[]; items: any[] }> {
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
    // Chama API de parsing
    const response = await fetch(`${SERVER_URL}/api/playlist/parse`, {
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
      signal: AbortSignal.timeout(600000), // 600s (10min) timeout - servidor pode fazer 3 retries de 5min
    });

    if (!response.ok) {
      throw new Error(`Erro do servidor: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Erro ao processar playlist no servidor');
    }

    onProgress?.({
      phase: 'downloading',
      current: 50,
      total: 100,
      percentage: 50,
      message: result.cached ? 'Cache hit no servidor!' : 'Processado no servidor',
    });

    // Busca itens em páginas até completar tudo
    const allItems: any[] = [];
    let offset = 0;
    let total = 0;

    while (true) {
      const itemsResponse = await fetch(
        `${SERVER_URL}/api/playlist/items/${result.hash}?limit=5000&offset=${offset}`
      );

      if (!itemsResponse.ok) {
        throw new Error(`Erro ao buscar itens: ${itemsResponse.status}`);
      }

      const page = await itemsResponse.json();
      allItems.push(...(page.items || []));
      total = page.total || allItems.length;

      if (allItems.length >= total || (page.items || []).length === 0) {
        break;
      }

      offset += page.limit || 5000;
    }

    onProgress?.({
      phase: 'downloading',
      current: 100,
      total: 100,
      percentage: 100,
      message: 'Download completo!',
    });

    return {
      stats: result.data.stats,
      groups: result.data.groups,
      items: allItems,
    };

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
 * Adiciona uma nova playlist a partir de uma URL
 * Usa APENAS o servidor para processar M3U (sem fallback client-side)
 */
export async function addPlaylist(
  url: string,
  name?: string,
  onProgress?: ProgressCallback
): Promise<string> {
  // Verifica limite de playlists
  const playlistCount = await db.playlists.count();
  if (playlistCount >= MAX_PLAYLISTS) {
    throw new Error(`Limite de ${MAX_PLAYLISTS} playlists atingido`);
  }

  // Verifica se URL ja existe
  const existing = await db.playlists.where('url').equals(url).first();
  if (existing) {
    throw new Error('Esta playlist ja foi adicionada');
  }

  // Gera ID unico
  const playlistId = `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // APENAS SERVIDOR (sem fallback)
  const parsed = await fetchFromServer(url, onProgress);

  // Determina se deve ser ativa (primeira playlist = ativa)
  const isFirst = playlistCount === 0;

  // DEBUG: Log antes de salvar
  console.log('[DB DEBUG] ===== SALVANDO PLAYLIST =====');
  console.log('[DB DEBUG] PlaylistId:', playlistId);
  console.log('[DB DEBUG] Items a salvar:', parsed.items.length);
  console.log('[DB DEBUG] Groups a salvar:', parsed.groups.length);
  console.log('[DB DEBUG] Stats:', parsed.stats);

  // Salva no banco
  await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
    // Cria registro da playlist
    const playlist: Playlist = {
      id: playlistId,
      name: name || extractNameFromUrl(url),
      url,
      isActive: isFirst ? 1 : 0,
      lastUpdated: Date.now(),
      lastSyncStatus: 'success',
      itemCount: parsed.stats.totalItems,
      liveCount: parsed.stats.liveCount,
      movieCount: parsed.stats.movieCount,
      seriesCount: parsed.stats.seriesCount,
      createdAt: Date.now(),
    };
    console.log('[DB DEBUG] Playlist object:', playlist);
    await db.playlists.add(playlist);

    // Se items array está vazio, significa que streaming parser já inseriu no DB
    // Apenas salvamos grupos nesse caso
    if (parsed.items.length > 0) {
      console.log('[DB DEBUG] Inserindo itens no DB');
      const items: M3UItem[] = parsed.items.map((item: any) => ({
        id: `${playlistId}_${item.id}`,
        playlistId,
        name: item.name,
        url: item.url,
        logo: item.logo,
        group: item.group,
        mediaKind: item.mediaKind,
        title: item.parsedTitle?.title || item.title || item.name,
        year: item.parsedTitle?.year || item.year,
        season: item.parsedTitle?.season || item.season,
        episode: item.parsedTitle?.episode || item.episode,
        quality: item.parsedTitle?.quality || item.quality,
        epgId: item.epgId,
        createdAt: Date.now(),
      }));

      // Insere em lotes de 500
      const batchSize = 500;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await db.items.bulkAdd(batch);
      }
    } else {
      console.log('[DB DEBUG] Items já inseridos pelo streaming parser');
    }

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
  const savedItemsCount = await db.items.where('playlistId').equals(playlistId).count();
  const savedGroupsCount = await db.groups.where('playlistId').equals(playlistId).count();
  console.log('[DB DEBUG] ===== VERIFICAÇÃO PÓS-SAVE =====');
  console.log('[DB DEBUG] Playlist salva:', savedPlaylist);
  console.log('[DB DEBUG] Items salvos:', savedItemsCount);
  console.log('[DB DEBUG] Groups salvos:', savedGroupsCount);

  // Verifica grupos por mediaKind
  const movieGroups = await db.groups.where({ playlistId, mediaKind: 'movie' }).count();
  const seriesGroups = await db.groups.where({ playlistId, mediaKind: 'series' }).count();
  const liveGroups = await db.groups.where({ playlistId, mediaKind: 'live' }).count();
  console.log('[DB DEBUG] Movie groups:', movieGroups);
  console.log('[DB DEBUG] Series groups:', seriesGroups);
  console.log('[DB DEBUG] Live groups:', liveGroups);

  return playlistId;
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

  // Re-processa usando servidor
  const parsed = await fetchFromServer(playlist.url, onProgress);

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

    // Re-insere itens (vindos do servidor)
    if (parsed.items.length > 0) {
      const items: M3UItem[] = parsed.items.map((item: any) => ({
        id: `${playlistId}_${item.id}`,
        playlistId,
        name: item.name,
        url: item.url,
        logo: item.logo,
        group: item.group,
        mediaKind: item.mediaKind,
        title: item.parsedTitle?.title || item.title || item.name,
        year: item.parsedTitle?.year || item.year,
        season: item.parsedTitle?.season || item.season,
        episode: item.parsedTitle?.episode || item.episode,
        quality: item.parsedTitle?.quality || item.quality,
        epgId: item.epgId,
        createdAt: Date.now(),
      }));

      const batchSize = 500;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await db.items.bulkAdd(batch);
      }
    }

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
