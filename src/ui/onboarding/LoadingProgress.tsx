/**
 * LoadingProgress
 * Tela de carregamento com progresso do parser
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '@store/onboardingStore';
import { usePlaylistStore } from '@store/playlistStore';
import { addPlaylist } from '@core/db';
import styles from './LoadingProgress.module.css';

export function LoadingProgress() {
  const navigate = useNavigate();
  const { playlistUrl, progress, setProgress, setError } = useOnboardingStore();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const activePlaylist = usePlaylistStore((s) => s.activePlaylist);
  const earlyNavDone = useRef(false);
  const optimisticTimer = useRef<ReturnType<typeof setInterval>>();
  const [optimisticPct, setOptimisticPct] = useState(1);

  useEffect(() => {
    if (!playlistUrl) {
      navigate('/onboarding/input', { replace: true });
      return;
    }

    let cancelled = false;

    async function loadPlaylist() {
      try {
        console.log('[LOADING DEBUG] Iniciando addPlaylist (fire-and-forget)...');

        // Força progress inicial para movimentar a barra imediatamente
        setProgress({
          phase: 'downloading',
          current: 1,
          total: 100,
          percentage: 1,
          message: 'Conectando ao servidor...',
        });

        // ✅ FASE 7.1: addPlaylist retorna IMEDIATAMENTE após early ready (500 items)
        // Navegação acontece automaticamente via early callback + useEffect abaixo
        await addPlaylist(playlistUrl, undefined, (p) => {
          if (!cancelled) {
            setProgress(p);
          }
        });

        console.log('[LOADING DEBUG] ✓ addPlaylist retornou (parsing continua em background)');

        // ✅ FASE 7.1: Navegação agora é automática via useEffect (linhas 115-124)
        // quando activePlaylist é setado pelo early callback
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

  // Otimismo: avança a barra enquanto não chegam updates reais do parser
  useEffect(() => {
    if (progress && progress.percentage > optimisticPct) {
      setOptimisticPct(progress.percentage);
    }

    // Inicia timer se não há progresso ou está parado em 0
    if (!progress || progress.percentage < 1) {
      if (!optimisticTimer.current) {
        optimisticTimer.current = setInterval(() => {
          setOptimisticPct((prev) => (prev < 15 ? prev + 1 : prev));
        }, 400);
      }
    } else {
      if (optimisticTimer.current) {
        clearInterval(optimisticTimer.current);
        optimisticTimer.current = undefined;
      }
    }

    return () => {
      if (optimisticTimer.current) {
        clearInterval(optimisticTimer.current);
        optimisticTimer.current = undefined;
      }
    };
  }, [progress, optimisticPct]);

  // ✅ FASE 7.1: Navegação automática quando playlist ativa é setada (após early ready)
  // - activePlaylist é setado pelo early callback de operations.ts (após 500 items)
  // - Navega IMEDIATAMENTE para home (parsing continua em background)
  useEffect(() => {
    if (earlyNavDone.current) return;
    if (!activePlaylist) return;

    // Navega assim que playlist estiver ativa (sem esperar parsing completo)
    console.log('[LOADING DEBUG] ✅ Playlist ativa detectada! Navegando para /home...');
    earlyNavDone.current = true;
    navigate('/home', { replace: true });
  }, [activePlaylist, navigate]);

  const percentage = Math.max(progress?.percentage ?? 0, optimisticPct);
  const message = progress?.message ?? 'Conectando ao servidor...';

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
