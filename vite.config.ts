import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { fileURLToPath, URL } from 'node:url';

/**
 * Plugin para proxy CORS em desenvolvimento
 * Permite fetch de URLs externas sem restricao CORS no browser
 */
function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use('/cors-proxy', async (req, res) => {
        // Extrai a URL encodada do path
        const encodedUrl = (req.url || '').slice(1); // Remove leading /
        if (!encodedUrl) {
          res.statusCode = 400;
          res.end('URL nao fornecida');
          return;
        }

        try {
          const targetUrl = decodeURIComponent(encodedUrl);

          // Faz fetch da URL externa
          const response = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'AtivePlay/1.0',
            },
          });

          // Copia headers relevantes
          res.statusCode = response.status;
          const contentType = response.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }

          // Adiciona headers CORS
          res.setHeader('Access-Control-Allow-Origin', '*');

          // Envia o corpo
          const body = await response.text();
          res.end(body);
        } catch (error) {
          console.error('[CORS Proxy] Erro:', error);
          res.statusCode = 500;
          res.end(`Erro no proxy: ${(error as Error).message}`);
        }
      });
    },
  };
}

const enableLegacy = process.env.VITE_NO_LEGACY !== '1';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Em dev: base '/' (raiz absoluta) para servidor funcionar
  // Em build: base './' (relativo) para file:// protocol do IPK
  base: command === 'serve' ? '/' : './',
  plugins: [
    react(),
    ...(enableLegacy
      ? [
          legacy({
            targets: ['chrome >= 47', 'safari >= 10'],
            additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
            renderLegacyChunks: true,
            modernPolyfills: true,
          }),
        ]
      : []),
    corsProxyPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@player': fileURLToPath(new URL('./src/player', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/store', import.meta.url)),
    },
  },
  build: {
    target: 'es2015',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          db: ['dexie', 'dexie-react-hooks'],
          navigation: ['@noriginmedia/norigin-spatial-navigation'],
        },
      },
    },
    // Limite de chunk para TVs com memoria limitada
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 3000,
    host: true, // Permite acesso via IP local para teste em TVs
  },
  preview: {
    port: 3000,
    host: true,
  },
}));
