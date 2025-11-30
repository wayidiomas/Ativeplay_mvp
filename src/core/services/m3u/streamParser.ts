/**
 * Streaming M3U Parser
 * Parseia playlists M3U progressivamente usando ReadableStream
 * Reduz uso de memória de 300MB+ para ~1-2MB
 */

import { ContentClassifier } from './classifier';
import type { M3UParsedItem, MediaKind } from './types';

/**
 * Gera um ID único para um item
 */
function generateItemId(url: string, index: number): string {
  const hash = url.split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);
  return `item_${Math.abs(hash)}_${index}`;
}

/**
 * Interface para metadados EXTINF
 */
interface ExtinfData {
  duration: number;
  attributes: Map<string, string>;
  title: string;
}

/**
 * Parseia uma linha EXTINF
 * Formato: #EXTINF:duration tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Title
 */
function parseExtinf(line: string): ExtinfData | null {
  // Remove #EXTINF: prefix
  if (!line.startsWith('#EXTINF:')) return null;

  const content = line.substring(8); // Remove '#EXTINF:'

  // Split em duration e resto
  const firstComma = content.indexOf(',');
  if (firstComma === -1) return null;

  const header = content.substring(0, firstComma);
  const title = content.substring(firstComma + 1).trim();

  // Parse duration (geralmente -1 para streams)
  const durationMatch = header.match(/^-?\d+/);
  const duration = durationMatch ? parseInt(durationMatch[0], 10) : -1;

  // Parse attributes (tvg-id="..." tvg-name="..." etc)
  const attributes = new Map<string, string>();
  const attrRegex = /(\w+(?:-\w+)*)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(header)) !== null) {
    attributes.set(match[1], match[2]);
  }

  return { duration, attributes, title };
}

/**
 * Retorna URL com proxy para desenvolvimento (evita CORS no browser)
 */
function getProxiedUrl(url: string): string {
  if (import.meta.env.DEV) {
    return `/cors-proxy/${encodeURIComponent(url)}`;
  }
  return url;
}

/**
 * Stream M3U parser - yields items progressivamente
 *
 * Uso de memória: ~1-2MB (vs 300MB+ do parser tradicional)
 *
 * @param url URL da playlist M3U
 * @yields M3UParsedItem - um item por vez
 */
export async function* streamParseM3U(
  url: string
): AsyncGenerator<M3UParsedItem, void, unknown> {
  const fetchUrl = getProxiedUrl(url);

  console.log('[StreamParser] Iniciando download:', fetchUrl);

  const response = await fetch(fetchUrl, {
    headers: {
      'User-Agent': 'AtivePlay/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body não disponível');
  }

  // ✅ Log do tamanho do arquivo se disponível
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const sizeMB = (parseInt(contentLength) / 1024 / 1024).toFixed(2);
    console.log(`[StreamParser] Tamanho do arquivo: ${sizeMB} MB`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let currentExtinf: ExtinfData | null = null;
  let itemIndex = 0;
  let foundHeader = false;
  let bytesRead = 0;
  let lastLogTime = Date.now();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log(`[StreamParser] ✓ Stream completo! Total: ${itemIndex} items, ${(bytesRead / 1024 / 1024).toFixed(2)} MB lidos`);
        break;
      }

      // ✅ Track bytes lidos
      bytesRead += value.byteLength;

      // ✅ Log progress a cada 5MB
      if (bytesRead % (5 * 1024 * 1024) < value.byteLength) {
        const now = Date.now();
        const elapsed = (now - lastLogTime) / 1000;
        const speed = elapsed > 0 ? ((5 * 1024 * 1024) / elapsed / 1024 / 1024).toFixed(2) : '0';
        console.log(`[StreamParser] Progress: ${itemIndex} items, ${(bytesRead / 1024 / 1024).toFixed(2)} MB (${speed} MB/s)`);
        lastLogTime = now;
      }

      // Decode chunk e adiciona ao buffer
      buffer += decoder.decode(value, { stream: true });

      // Split em linhas (mantém última linha incompleta no buffer)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) continue;

        // Verifica header M3U
        if (trimmed === '#EXTM3U') {
          foundHeader = true;
          continue;
        }

        // Ignora comentários que não são EXTINF
        if (trimmed.startsWith('#') && !trimmed.startsWith('#EXTINF:')) {
          continue;
        }

        // Parseia EXTINF
        if (trimmed.startsWith('#EXTINF:')) {
          currentExtinf = parseExtinf(trimmed);
          continue;
        }

        // Linha com URL do stream
        if (currentExtinf && trimmed.startsWith('http')) {
          const streamUrl = trimmed;
          const name = currentExtinf.title;

          // Extrai metadados dos attributes
          const tvgId = currentExtinf.attributes.get('tvg-id');
          const tvgLogo = currentExtinf.attributes.get('tvg-logo');
          const groupTitle = currentExtinf.attributes.get('group-title') || 'Sem Grupo';

          // Classifica conteúdo
          const mediaKind: MediaKind = ContentClassifier.classify(name, groupTitle);
          const parsedTitle = ContentClassifier.parseTitle(name);

          // Cria item parseado
          const item: M3UParsedItem = {
            id: generateItemId(streamUrl, itemIndex++),
            name,
            url: streamUrl,
            logo: tvgLogo,
            group: groupTitle,
            mediaKind,
            epgId: tvgId,
            parsedTitle,
          };

          // Yield item para processamento
          yield item;

          // Reset current extinf
          currentExtinf = null;
        }
      }
    }

    // Processa última linha do buffer se houver
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (currentExtinf && trimmed.startsWith('http')) {
        const streamUrl = trimmed;
        const name = currentExtinf.title;
        const tvgId = currentExtinf.attributes.get('tvg-id');
        const tvgLogo = currentExtinf.attributes.get('tvg-logo');
        const groupTitle = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
        const mediaKind: MediaKind = ContentClassifier.classify(name, groupTitle);
        const parsedTitle = ContentClassifier.parseTitle(name);

        yield {
          id: generateItemId(streamUrl, itemIndex++),
          name,
          url: streamUrl,
          logo: tvgLogo,
          group: groupTitle,
          mediaKind,
          epgId: tvgId,
          parsedTitle,
        };
      }
    }

    if (!foundHeader) {
      throw new Error('Formato de playlist inválido (falta #EXTM3U)');
    }

    // ✅ Verifica se baixamos tudo que era esperado
    if (contentLength) {
      const expectedBytes = parseInt(contentLength);
      const percentComplete = ((bytesRead / expectedBytes) * 100).toFixed(2);
      if (bytesRead < expectedBytes) {
        console.warn(`[StreamParser] ⚠️ AVISO: Stream incompleto! Lido ${bytesRead} de ${expectedBytes} bytes (${percentComplete}%)`);
      } else {
        console.log(`[StreamParser] ✓ Download completo: 100% (${itemIndex} items)`);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default { streamParseM3U };
