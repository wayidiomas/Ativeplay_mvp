/**
 * Subtitle Types
 * Tipos para o sistema de legendas do AtivePlay
 */

// Cue de legenda (unidade basica)
export interface SubtitleCue {
  index: number;
  startTime: number; // milissegundos
  endTime: number; // milissegundos
  text: string;
}

// Formato de legenda detectado
export type SubtitleFormat = 'vtt' | 'srt' | 'ass' | 'unknown';

// Fonte da legenda
export type SubtitleSource = 'embedded' | 'manual' | 'url';

// Estilo de legenda customizavel
export interface SubtitleStyle {
  fontSize: number; // 50-200 (%)
  fontFamily: string;
  color: string; // hex color
  backgroundColor: string; // rgba
  position: 'top' | 'center' | 'bottom';
  edgeStyle: 'none' | 'outline' | 'shadow' | 'raised' | 'depressed';
  edgeColor: string;
  opacity: number; // 0-1
}

// Preferencias de legenda do usuario
export interface SubtitlePreferences {
  preferredLanguages: string[];
  style: SubtitleStyle;
}

// Track de legenda disponivel (embutida ou externa)
export interface SubtitleTrack {
  id: string | number;
  language: string;
  label: string;
  isDefault: boolean;
  source: SubtitleSource;
  url?: string; // para URL externa
}

// Estilo padrao
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 100,
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#FFFFFF',
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  position: 'bottom',
  edgeStyle: 'outline',
  edgeColor: '#000000',
  opacity: 1,
};

// Preferencias padrao
export const DEFAULT_SUBTITLE_PREFERENCES: SubtitlePreferences = {
  preferredLanguages: ['pt', 'en'],
  style: DEFAULT_SUBTITLE_STYLE,
};

// Mapa de codigos de idioma
export const LANGUAGE_CODES: Record<string, string> = {
  pt: 'Portugues',
  'pt-br': 'Portugues (Brasil)',
  'pt-pt': 'Portugues (Portugal)',
  en: 'English',
  es: 'Espanol',
  fr: 'Francais',
  de: 'Deutsch',
  it: 'Italiano',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  pl: 'Polish',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
};
