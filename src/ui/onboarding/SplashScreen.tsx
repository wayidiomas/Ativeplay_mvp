/**
 * SplashScreen
 * Tela inicial - verifica se tem playlist salva e valida com backend
 *
 * Flow:
 * 1. Check localStorage for saved hash
 * 2. Validate with backend API
 * 3. If valid → go to home
 * 4. If invalid/expired → re-parse or show QR onboarding
 */

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '@store/playlistStore';
import { useOnboardingStore } from '@store/onboardingStore';
import { validateCache } from '@core/services/api';
import styles from './SplashScreen.module.css';

export function SplashScreen() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('Carregando...');
  const checkDone = useRef(false);

  // Store state
  const savedHash = usePlaylistStore((s) => s.hash);
  const savedUrl = usePlaylistStore((s) => s.url);
  const setPlaylist = usePlaylistStore((s) => s.setPlaylist);
  const setPlaylistUrl = useOnboardingStore((s) => s.setPlaylistUrl);

  useEffect(() => {
    if (checkDone.current) return;
    checkDone.current = true;

    async function checkAndResume() {
      // Case 1: No saved hash → show onboarding
      if (!savedHash) {
        console.log('[SplashScreen] No saved playlist, showing onboarding');
        setMessage('Bem-vindo!');

        setTimeout(() => {
          navigate('/onboarding/input', { replace: true });
        }, 1000);
        return;
      }

      // Case 2: Has saved hash → validate with backend
      console.log('[SplashScreen] Validating saved hash:', savedHash);
      setMessage('Verificando playlist...');

      try {
        const result = await validateCache(savedHash);

        if (result.valid) {
          // Cache is valid → go to home
          console.log('[SplashScreen] Cache valid, going to home');
          setMessage('Playlist encontrada!');

          // Update store with fresh data from backend
          if (result.stats) {
            setPlaylist({
              hash: savedHash,
              url: result.url || savedUrl || '',
              name: extractNameFromUrl(result.url || savedUrl || ''),
              stats: result.stats,
              savedAt: Date.now(),
            });
          }

          setTimeout(() => {
            navigate('/home', { replace: true });
          }, 500);
        } else {
          // Cache expired or invalid
          console.log('[SplashScreen] Cache expired/invalid');

          // If we have the URL, auto-reparse
          const urlToReparse = result.url || savedUrl;
          if (urlToReparse) {
            setMessage('Atualizando playlist...');
            setPlaylistUrl(urlToReparse);
            setTimeout(() => {
              navigate('/onboarding/loading', { replace: true });
            }, 500);
          } else {
            // No URL to reparse → show onboarding
            setMessage('Playlist expirada');
            setTimeout(() => {
              navigate('/onboarding/input', { replace: true });
            }, 1000);
          }
        }
      } catch (error) {
        console.error('[SplashScreen] Validation error:', error);

        // Network error - try to use cached data if available
        if (savedUrl) {
          setMessage('Reconectando...');
          setPlaylistUrl(savedUrl);
          setTimeout(() => {
            navigate('/onboarding/loading', { replace: true });
          }, 1000);
        } else {
          setMessage('Erro de conexao');
          setTimeout(() => {
            navigate('/onboarding/input', { replace: true });
          }, 1500);
        }
      }
    }

    // Small delay for splash effect
    setTimeout(checkAndResume, 800);
  }, [savedHash, savedUrl, navigate, setPlaylist, setPlaylistUrl]);

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
        <p className={styles.text}>{message}</p>
      </div>
      <p className={styles.version}>v{import.meta.env.VITE_APP_VERSION}</p>
    </div>
  );
}

function extractNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    return hostname.charAt(0).toUpperCase() + hostname.slice(1);
  } catch {
    return 'Minha Playlist';
  }
}

export default SplashScreen;
