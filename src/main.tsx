import '@/core/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import App from './App';
import '@/styles/variables.css';
import '@/styles/global.css';

// Inicializa navegacao espacial D-PAD
// Desabilitamos visualDebug para evitar outlines vermelhos no input/botoes.
const spatialDebug = import.meta.env.VITE_SPATIAL_DEBUG === 'true';
init({
  debug: spatialDebug,
  visualDebug: false,
  throttle: 50, // avoid duplicate key events on slow TV remotes
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
