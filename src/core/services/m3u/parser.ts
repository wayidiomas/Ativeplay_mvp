/**
 * M3U Parser
 * Parseia playlists M3U/M3U8 e classifica o conteudo
 */

import parser from 'iptv-playlist-parser';
import { ContentClassifier } from './classifier';
import type {
  M3URawItem,
  M3UParsedItem,
  M3UGroup,
  M3UPlaylist,
  PlaylistStats,
  MediaKind,
  ParserProgress,
} from './types';

export type ProgressCallback = (progress: ParserProgress) => void;

/**
 * Retorna URL com proxy para desenvolvimento (evita CORS no browser)
 * Em producao (Smart TVs), usa URL direta pois nao ha restricao CORS
 */
function getProxiedUrl(url: string): string {
  if (import.meta.env.DEV) {
    // Em desenvolvimento, usa proxy do Vite para evitar CORS
    return `/cors-proxy/${encodeURIComponent(url)}`;
  }
  // Em producao (Smart TVs), acesso direto funciona
  return url;
}

/**
 * Gera um ID unico para um item
 */
function generateItemId(url: string, index: number): string {
  // Usa hash simples da URL + index para garantir unicidade
  const hash = url.split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);
  return `item_${Math.abs(hash)}_${index}`;
}

/**
 * Gera um ID unico para um grupo
 */
function generateGroupId(name: string, mediaKind: MediaKind): string {
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `group_${safeName}_${mediaKind}`;
}

/**
 * Parseia uma playlist M3U
 */
export async function parseM3U(
  content: string,
  _playlistId: string,
  onProgress?: ProgressCallback
): Promise<M3UPlaylist> {
  // Report progress: parsing
  onProgress?.({
    phase: 'parsing',
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Analisando playlist...',
  });

  // Parse using iptv-playlist-parser
  let rawItems: M3URawItem[];
  try {
    const parsed = parser.parse(content);
    rawItems = parsed.items as M3URawItem[];
  } catch (error) {
    throw new Error(`Erro ao parsear playlist: ${(error as Error).message}`);
  }

  const totalItems = rawItems.length;

  if (totalItems === 0) {
    throw new Error('Playlist vazia ou formato invalido');
  }

  onProgress?.({
    phase: 'classifying',
    current: 0,
    total: totalItems,
    percentage: 0,
    message: `Classificando ${totalItems} itens...`,
  });

  // Process and classify items
  const items: M3UParsedItem[] = [];
  const groupsMap = new Map<string, M3UGroup>();
  const stats: PlaylistStats = {
    totalItems: 0,
    liveCount: 0,
    movieCount: 0,
    seriesCount: 0,
    unknownCount: 0,
    groupCount: 0,
  };

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];

    // Skip invalid items
    if (!raw.url || !raw.name) continue;

    const groupName = raw.group?.title || 'Sem Grupo';
    const mediaKind = ContentClassifier.classify(raw.name, groupName);
    const parsedTitle = ContentClassifier.parseTitle(raw.name);

    // DEBUG: Log primeiros 20 itens para ver classificação
    if (i < 20) {
      console.log(`[PARSER DEBUG] Item ${i}: group="${groupName}" name="${raw.name}" → ${mediaKind}`);
    }

    const item: M3UParsedItem = {
      id: generateItemId(raw.url, i),
      name: raw.name,
      url: raw.url,
      logo: raw.tvg?.logo,
      group: groupName,
      mediaKind,
      epgId: raw.tvg?.id,
      parsedTitle,
    };

    items.push(item);

    // Update stats
    stats.totalItems++;
    switch (mediaKind) {
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
    const groupId = generateGroupId(groupName, mediaKind);
    const existingGroup = groupsMap.get(groupId);
    if (existingGroup) {
      existingGroup.itemCount++;
    } else {
      groupsMap.set(groupId, {
        id: groupId,
        name: groupName,
        mediaKind,
        itemCount: 1,
        logo: raw.tvg?.logo,
      });
    }

    // Report progress every 100 items
    if (i % 100 === 0) {
      const percentage = Math.round((i / totalItems) * 100);
      onProgress?.({
        phase: 'classifying',
        current: i,
        total: totalItems,
        percentage,
        message: `Classificando ${i} de ${totalItems} itens...`,
      });
    }
  }

  const groups = Array.from(groupsMap.values());
  stats.groupCount = groups.length;

  // DEBUG: Log stats finais
  console.log('[PARSER DEBUG] ===== STATS FINAIS =====');
  console.log(`[PARSER DEBUG] Total Items: ${stats.totalItems}`);
  console.log(`[PARSER DEBUG] Movies: ${stats.movieCount}`);
  console.log(`[PARSER DEBUG] Series: ${stats.seriesCount}`);
  console.log(`[PARSER DEBUG] Live: ${stats.liveCount}`);
  console.log(`[PARSER DEBUG] Unknown: ${stats.unknownCount}`);
  console.log(`[PARSER DEBUG] Groups: ${stats.groupCount}`);
  console.log('[PARSER DEBUG] Primeiros 5 grupos:', groups.slice(0, 5));

  onProgress?.({
    phase: 'complete',
    current: totalItems,
    total: totalItems,
    percentage: 100,
    message: `Concluido! ${stats.totalItems} itens processados.`,
  });

  return {
    url: '', // Will be set by caller
    items,
    groups,
    stats,
  };
}

/**
 * Faz download e parseia uma playlist M3U de uma URL
 */
export async function fetchAndParseM3U(
  url: string,
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<M3UPlaylist> {
  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Baixando playlist...',
  });

  try {
    const fetchUrl = getProxiedUrl(url);
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'AtivePlay/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    if (!content.includes('#EXTM3U')) {
      throw new Error('Formato de playlist invalido (falta #EXTM3U)');
    }

    onProgress?.({
      phase: 'downloading',
      current: 100,
      total: 100,
      percentage: 100,
      message: 'Download completo!',
    });

    const playlist = await parseM3U(content, playlistId, onProgress);
    playlist.url = url;

    return playlist;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    onProgress?.({
      phase: 'error',
      current: 0,
      total: 100,
      percentage: 0,
      message: errorMessage,
    });
    throw error;
  }
}

export default { parseM3U, fetchAndParseM3U };
