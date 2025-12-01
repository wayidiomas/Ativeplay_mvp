/**
 * LoadingProgress
 * Sends playlist URL to Rust backend for parsing
 * Backend handles all heavy lifting - frontend just shows progress
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '@store/onboardingStore';
import { usePlaylistStore } from '@store/playlistStore';
import { parsePlaylist } from '@core/services/api';
import styles from './LoadingProgress.module.css';

type Phase = 'connecting' | 'parsing' | 'complete' | 'error';

export function LoadingProgress() {
  const navigate = useNavigate();
  const { playlistUrl, setError } = useOnboardingStore();
  const setPlaylist = usePlaylistStore((s) => s.setPlaylist);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [message, setMessage] = useState('Conectando ao servidor...');
  const [percentage, setPercentage] = useState(5);
  const parseStarted = useRef(false);
  const optimisticTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!playlistUrl) {
      navigate('/onboarding/input', { replace: true });
      return;
    }

    if (parseStarted.current) return;
    parseStarted.current = true;

    // Optimistic progress while waiting for backend
    optimisticTimer.current = setInterval(() => {
      setPercentage((prev) => {
        if (prev < 30) return prev + 2;
        if (prev < 60) return prev + 1;
        if (prev < 85) return prev + 0.5;
        return prev;
      });
    }, 300);

    async function sendToBackend() {
      try {
        console.log('[LoadingProgress] Sending to backend:', playlistUrl);
        setPhase('parsing');
        setMessage('Processando playlist...');

        // Backend does all the parsing
        const result = await parsePlaylist(playlistUrl);

        // Clear optimistic timer
        if (optimisticTimer.current) {
          clearInterval(optimisticTimer.current);
        }

        if (result.success) {
          console.log('[LoadingProgress] Parse complete:', result);
          setPhase('complete');
          setPercentage(100);
          setMessage('Concluido!');

          // Save to store for persistence
          setPlaylist({
            hash: result.hash,
            url: playlistUrl,
            name: extractNameFromUrl(playlistUrl),
            stats: result.stats,
            savedAt: Date.now(),
          });

          // Navigate to home
          setTimeout(() => {
            navigate('/home', { replace: true });
          }, 500);
        } else {
          throw new Error('Parse failed');
        }
      } catch (err) {
        console.error('[LoadingProgress] Error:', err);

        if (optimisticTimer.current) {
          clearInterval(optimisticTimer.current);
        }

        setPhase('error');
        const errorMsg = err instanceof Error ? err.message : 'Erro ao processar playlist';
        setMessage(errorMsg);
        setError(errorMsg);

        setTimeout(() => {
          navigate('/onboarding/error', { replace: true });
        }, 1500);
      }
    }

    sendToBackend();

    return () => {
      if (optimisticTimer.current) {
        clearInterval(optimisticTimer.current);
      }
    };
  }, [playlistUrl, navigate, setError, setPlaylist]);

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Carregando Playlist</h1>

        <div className={styles.progressContainer}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round(percentage)}%` }}
            />
          </div>
          <span className={styles.percentage}>{Math.round(percentage)}%</span>
        </div>

        <p className={styles.message}>{message}</p>

        <div className={styles.phaseIndicator}>
          <PhaseStep
            label="Conectar"
            active={phase === 'connecting'}
            completed={phase !== 'connecting'}
          />
          <PhaseStep
            label="Processar"
            active={phase === 'parsing'}
            completed={phase === 'complete'}
          />
          <PhaseStep
            label="Concluido"
            active={phase === 'complete'}
            completed={false}
          />
        </div>
      </div>
    </div>
  );
}

function PhaseStep({
  label,
  active,
  completed,
}: {
  label: string;
  active: boolean;
  completed: boolean;
}) {
  return (
    <div
      className={`${styles.phase} ${active ? styles.active : ''} ${completed ? styles.completed : ''}`}
    >
      <div className={styles.phaseDot} />
      <span className={styles.phaseLabel}>{label}</span>
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

export default LoadingProgress;
