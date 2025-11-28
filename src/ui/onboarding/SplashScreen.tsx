/**
 * SplashScreen
 * Tela inicial exibida por 2 segundos enquanto verifica playlists
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@core/db/schema';
import { usePlaylistStore } from '@store/playlistStore';
import styles from './SplashScreen.module.css';

export function SplashScreen() {
  const navigate = useNavigate();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);

  // Busca playlist ativa
  const activePlaylist = useLiveQuery(
    () => db.playlists.where('isActive').equals(1).first(),
    []
  );

  useEffect(() => {
    // Timeout de segurança: se IndexedDB não responder em 5s, navega para onboarding
    const safetyTimer = setTimeout(() => {
      console.warn('[SplashScreen] IndexedDB timeout após 5s, navegando para onboarding');
      navigate('/onboarding/input', { replace: true });
    }, 5000);

    if (activePlaylist === undefined) {
      // Dexie ainda carregando, aguarda (com timeout de segurança acima)
      return () => clearTimeout(safetyTimer);
    }

    // IndexedDB respondeu, limpa timeout de segurança
    clearTimeout(safetyTimer);

    const timer = setTimeout(() => {
      if (activePlaylist) {
        setActivePlaylist(activePlaylist);
        navigate('/home', { replace: true });
      } else {
        navigate('/onboarding/input', { replace: true });
      }
    }, 1500); // mantém splash por pelo menos 1.5s

    return () => {
      clearTimeout(timer);
      clearTimeout(safetyTimer);
    };
  }, [activePlaylist, navigate, setActivePlaylist]);

  return (
    <div className={styles.container}>
      <div className={styles.logo}>
        <svg viewBox="0 0 100 100" className={styles.icon}>
          <rect width="100" height="100" rx="20" fill="var(--color-accent)" />
          <polygon points="35,25 75,50 35,75" fill="white" />
        </svg>
        <h1 className={styles.title}>AtivePlay</h1>
      </div>
      <div className={styles.loader}>
        <div className={styles.spinner} />
        <p className={styles.text}>Carregando...</p>
      </div>
      <p className={styles.version}>v{import.meta.env.VITE_APP_VERSION}</p>
    </div>
  );
}

export default SplashScreen;
