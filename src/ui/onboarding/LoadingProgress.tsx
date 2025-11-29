/**
 * LoadingProgress
 * Tela de carregamento com progresso do parser
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '@store/onboardingStore';
import { usePlaylistStore } from '@store/playlistStore';
import { addPlaylist, getActivePlaylist } from '@core/db';
import styles from './LoadingProgress.module.css';

export function LoadingProgress() {
  const navigate = useNavigate();
  const { playlistUrl, progress, setProgress, setError } = useOnboardingStore();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);

  useEffect(() => {
    if (!playlistUrl) {
      navigate('/onboarding/input', { replace: true });
      return;
    }

    let cancelled = false;

    async function loadPlaylist() {
      try {
        console.log('[LOADING DEBUG] Iniciando addPlaylist...');
        await addPlaylist(playlistUrl, undefined, (p) => {
          if (!cancelled) {
            setProgress(p);
          }
        });

        if (cancelled) return;

        console.log('[LOADING DEBUG] addPlaylist concluído! Buscando playlist ativa...');

        // Busca playlist ativa
        const active = await getActivePlaylist();
        console.log('[LOADING DEBUG] Playlist ativa encontrada:', active);

        if (active) {
          console.log('[LOADING DEBUG] Setando activePlaylist no Zustand...');
          setActivePlaylist(active);
          console.log('[LOADING DEBUG] activePlaylist setado!');

          // ✅ AGUARDA Dexie propagar mudanças para useLiveQuery (fix race condition)
          console.log('[LOADING DEBUG] Aguardando Dexie notification (100ms)...');
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log('[LOADING DEBUG] Dexie notification propagada!');
        } else {
          console.log('[LOADING DEBUG] NENHUMA playlist ativa encontrada!');
        }

        // Navega para home
        console.log('[LOADING DEBUG] Navegando para /home...');
        navigate('/home', { replace: true });
      } catch (err) {
        if (cancelled) return;
        console.error('[LOADING DEBUG] ERRO:', err);
        const message = err instanceof Error ? err.message : 'Erro ao carregar playlist';
        setError(message);
        navigate('/onboarding/error', { replace: true });
      }
    }

    loadPlaylist();

    return () => {
      cancelled = true;
    };
  }, [playlistUrl, navigate, setProgress, setError, setActivePlaylist]);

  const percentage = progress?.percentage ?? 0;
  const message = progress?.message ?? 'Iniciando...';

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Carregando Playlist</h1>

        <div className={styles.progressContainer}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className={styles.percentage}>{percentage}%</span>
        </div>

        <p className={styles.message}>{message}</p>

        <div className={styles.phaseIndicator}>
          <PhaseStep
            label="Download"
            active={progress?.phase === 'downloading'}
            completed={
              progress?.phase === 'parsing' ||
              progress?.phase === 'classifying' ||
              progress?.phase === 'indexing' ||
              progress?.phase === 'complete'
            }
          />
          <PhaseStep
            label="Analise"
            active={progress?.phase === 'parsing'}
            completed={
              progress?.phase === 'classifying' ||
              progress?.phase === 'indexing' ||
              progress?.phase === 'complete'
            }
          />
          <PhaseStep
            label="Classificacao"
            active={progress?.phase === 'classifying'}
            completed={
              progress?.phase === 'indexing' ||
              progress?.phase === 'complete'
            }
          />
          <PhaseStep
            label="Salvando"
            active={progress?.phase === 'indexing'}
            completed={progress?.phase === 'complete'}
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

export default LoadingProgress;
