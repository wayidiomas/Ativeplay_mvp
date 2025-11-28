/**
 * HLS Manifest Parser (EXT-X-MEDIA)
 * Extrai faixas de áudio e legendas declaradas no manifest master.
 */

export interface HlsMediaTrack {
  type: 'AUDIO' | 'SUBTITLES';
  groupId: string;
  name: string;
  language?: string;
  uri?: string;
  autoselect?: boolean;
  default?: boolean;
}

export interface HlsManifestInfo {
  audio: HlsMediaTrack[];
  subtitles: HlsMediaTrack[];
}

export function parseHlsManifest(manifest: string): HlsManifestInfo {
  const lines = manifest.split('\n');
  const info: HlsManifestInfo = { audio: [], subtitles: [] };

  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA')) continue;

    const attrs: Record<string, string> = {};
    const attrString = line.slice(line.indexOf(':') + 1);
    const regex = /([A-Z0-9-]+)=(".*?"|[^,]*)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(attrString)) !== null) {
      const key = match[1];
      const val = match[2].replace(/^"/, '').replace(/"$/, '');
      attrs[key] = val;
    }

    const type = attrs['TYPE'];
    if (type !== 'AUDIO' && type !== 'SUBTITLES') continue;

    const track: HlsMediaTrack = {
      type,
      groupId: attrs['GROUP-ID'] || '',
      name: attrs['NAME'] || '',
      language: attrs['LANGUAGE'],
      uri: attrs['URI'],
      autoselect: attrs['AUTOSELECT'] === 'YES',
      default: attrs['DEFAULT'] === 'YES',
    };

    if (type === 'AUDIO') {
      info.audio.push(track);
    } else {
      info.subtitles.push(track);
    }
  }

  return info;
}
