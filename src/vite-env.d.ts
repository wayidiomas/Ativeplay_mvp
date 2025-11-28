/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_MAX_PLAYLISTS: string;
  readonly VITE_ENABLE_EPG: string;
  readonly VITE_ENABLE_CONTINUE_WATCHING: string;
  readonly VITE_ENABLE_TMDB: string;
  readonly VITE_TMDB_API_KEY: string;
  readonly VITE_TMDB_ACCESS_TOKEN: string;
  readonly VITE_TMDB_BASE_URL: string;
  readonly VITE_TMDB_IMAGE_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
