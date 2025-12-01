/**
 * LoadingProgress
 * Polls backend for real-time parsing progress
 * Allows early navigation when enough items are parsed
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '@store/onboardingStore';
import { usePlaylistStore } from '@store/playlistStore';
import { parsePlaylist, getParseStatus, validateCache, type ParseStatus } from '@core/services/api';
import styles from './LoadingProgress.module.css';

type Phase = 'connecting' | 'parsing' | 'building' | 'complete' | 'error';

export function LoadingProgress() {
  const navigate = useNavigate();
  const { playlistUrl, setError } = useOnboardingStore();
  const setPlaylist = usePlaylistStore((s) => s.setPlaylist);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [message, setMessage] = useState('Conectando ao servidor...');
  const [percentage, setPercentage] = useState(5);
  const [hash, setHash] = useState<string | null>(null);
  const [canNavigate, setCanNavigate] = useState(false);
  const [realProgress, setRealProgress] = useState<ParseStatus | null>(null);

  const parseStarted = useRef(false);
  const pollInterval = useRef<ReturnType<typeof setInterval>>();

  // Calculate progress percentage from real data
  const calculateProgress = useCallback((status: ParseStatus): number => {
    if (status.status === 'complete') return 100;
    if (status.status === 'failed') return 0;

    const itemsParsed = status.itemsParsed || 0;
    const itemsTotal = status.itemsTotal || itemsParsed + 1000;

    // Reserve last 10% for building groups/series
    if (status.currentPhase === 'building_groups' || status.currentPhase === 'building_series') {
      return 90 + Math.min(9, (status.groupsCount || 0) / 10);
    }

    return Math.min(89, (itemsParsed / itemsTotal) * 89);
  }, []);

  // Get status message from phase
  const getPhaseMessage = useCallback((status: ParseStatus): string => {
    switch (status.currentPhase) {
      case 'downloading':
        return 'Baixando playlist...';
      case 'parsing':
        return `Processando: ${status.itemsParsed?.toLocaleString() || 0} items`;
      case 'building_groups':
        return 'Organizando grupos...';
      case 'building_series':
        return 'Detectando séries...';
      case 'done':
        return 'Concluído!';
      default:
        return 'Processando...';
    }
  }, []);

  // Poll for status
  const pollStatus = useCallback(async (hashToPoll: string) => {
    try {
      const status = await getParseStatus(hashToPoll);
      setRealProgress(status);

      // Update UI based on status
      const progress = calculateProgress(status);
      setPercentage(progress);
      setMessage(getPhaseMessage(status));

      // Enable early navigation when threshold reached
      if (status.canNavigate && !canNavigate) {
        setCanNavigate(true);
      }

      // Update phase
      if (status.currentPhase === 'building_groups' || status.currentPhase === 'building_series') {
        setPhase('building');
      } else if (status.currentPhase === 'parsing' || status.currentPhase === 'downloading') {
        setPhase('parsing');
      }

      // Handle completion
      if (status.status === 'complete') {
        setPhase('complete');
        setPercentage(100);
        setMessage('Concluído!');

        // Clear polling
        if (pollInterval.current) {
          clearInterval(pollInterval.current);
          pollInterval.current = undefined;
        }

        // Get final stats via validate
        const validation = await validateCache(hashToPoll);

        // Save to store
        setPlaylist({
          hash: hashToPoll,
          url: playlistUrl!,
          name: extractNameFromUrl(playlistUrl!),
          stats: validation.stats || {
            totalItems: status.itemsParsed || 0,
            liveCount: 0,
            movieCount: 0,
            seriesCount: status.seriesCount || 0,
            unknownCount: 0,
            groupCount: status.groupsCount || 0,
          },
          savedAt: Date.now(),
        });

        // Navigate to home
        setTimeout(() => {
          navigate('/home', { replace: true });
        }, 500);

        return;
      }

      // Handle failure
      if (status.status === 'failed') {
        if (pollInterval.current) {
          clearInterval(pollInterval.current);
          pollInterval.current = undefined;
        }

        setPhase('error');
        const errorMsg = status.error || 'Erro ao processar playlist';
        setMessage(errorMsg);
        setError(errorMsg);

        setTimeout(() => {
          navigate('/onboarding/error', { replace: true });
        }, 1500);
      }
    } catch (err) {
      console.error('[LoadingProgress] Poll error:', err);
      // Don't stop polling on transient errors
    }
  }, [calculateProgress, getPhaseMessage, canNavigate, playlistUrl, navigate, setPlaylist, setError]);

  // Handle early navigation
  const handleEarlyNavigate = useCallback(async () => {
    if (!hash || !realProgress) return;

    // Stop polling
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = undefined;
    }

    // Save partial state
    setPlaylist({
      hash,
      url: playlistUrl!,
      name: extractNameFromUrl(playlistUrl!),
      stats: {
        totalItems: realProgress.itemsParsed || 0,
        liveCount: 0,
        movieCount: 0,
        seriesCount: realProgress.seriesCount || 0,
        unknownCount: 0,
        groupCount: realProgress.groupsCount || 0,
      },
      savedAt: Date.now(),
    });

    navigate('/home', { replace: true });
  }, [hash, realProgress, playlistUrl, setPlaylist, navigate]);

  // Start parsing on mount
  useEffect(() => {
    if (!playlistUrl) {
      navigate('/onboarding/input', { replace: true });
      return;
    }

    if (parseStarted.current) return;
    parseStarted.current = true;

    async function startParsing() {
      try {
        console.log('[LoadingProgress] Starting parse:', playlistUrl);
        setPhase('connecting');
        setMessage('Conectando ao servidor...');

        // Send parse request - returns immediately with hash
        const result = await parsePlaylist(playlistUrl);
        console.log('[LoadingProgress] Parse initiated:', result);

        setHash(result.hash);

        // If already complete (cache hit), navigate immediately
        if (result.status === 'complete' && result.stats) {
          setPhase('complete');
          setPercentage(100);
          setMessage('Concluído!');

          setPlaylist({
            hash: result.hash,
            url: playlistUrl,
            name: extractNameFromUrl(playlistUrl),
            stats: result.stats,
            savedAt: Date.now(),
          });

          setTimeout(() => {
            navigate('/home', { replace: true });
          }, 500);

          return;
        }

        // Start polling for progress
        setPhase('parsing');
        setMessage('Iniciando processamento...');
        setPercentage(10);

        // Poll immediately then every 1 second
        pollStatus(result.hash);
        pollInterval.current = setInterval(() => {
          pollStatus(result.hash);
        }, 1000);
      } catch (err) {
        console.error('[LoadingProgress] Error:', err);

        setPhase('error');
        const errorMsg = err instanceof Error ? err.message : 'Erro ao processar playlist';
        setMessage(errorMsg);
        setError(errorMsg);

        setTimeout(() => {
          navigate('/onboarding/error', { replace: true });
        }, 1500);
      }
    }

    startParsing();

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [playlistUrl, navigate, setError, setPlaylist, pollStatus]);

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

        {/* Real-time stats */}
        {realProgress && realProgress.itemsParsed && realProgress.itemsParsed > 0 && (
          <p className={styles.stats}>
            {realProgress.itemsParsed.toLocaleString()} items
            {realProgress.groupsCount ? ` • ${realProgress.groupsCount} grupos` : ''}
          </p>
        )}

        <div className={styles.phaseIndicator}>
          <PhaseStep
            label="Conectar"
            active={phase === 'connecting'}
            completed={phase !== 'connecting'}
          />
          <PhaseStep
            label="Processar"
            active={phase === 'parsing'}
            completed={phase === 'building' || phase === 'complete'}
          />
          <PhaseStep
            label="Organizar"
            active={phase === 'building'}
            completed={phase === 'complete'}
          />
          <PhaseStep
            label="Concluído"
            active={phase === 'complete'}
            completed={false}
          />
        </div>

        {/* Early navigation button */}
        {canNavigate && phase !== 'complete' && phase !== 'error' && (
          <button
            className={styles.earlyNavButton}
            onClick={handleEarlyNavigate}
          >
            Ir para Home ({realProgress?.itemsParsed?.toLocaleString() || 0} items prontos)
          </button>
        )}
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
