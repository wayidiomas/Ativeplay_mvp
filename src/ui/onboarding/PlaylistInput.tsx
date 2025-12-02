/**
 * PlaylistInput
 * Tela para entrada da URL da playlist M3U
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { useOnboardingStore } from '@store/onboardingStore';
import { useQRSession } from '@core/hooks/useQRSession';
import styles from './PlaylistInput.module.css';

export function PlaylistInput() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const setPlaylistUrl = useOnboardingStore((s) => s.setPlaylistUrl);

  // QR Code session
  const {
    qrDataUrl,
    isLoading: qrLoading,
    error: qrError,
    receivedUrl,
    startSession,
    stopSession,
  } = useQRSession((receivedPlaylistUrl) => {
    // Quando URL é recebida do celular, preenche o input e foca no botão
    setUrl(receivedPlaylistUrl);
    setError('');
    // Focus on submit button so user can just press Enter
    setTimeout(() => setFocus('submit-button'), 100);
  });

  const { ref: containerRef, focusKey } = useFocusable({
    focusKey: 'playlist-input-container',
    isFocusBoundary: true,
  });

  const { ref: inputFocusRef, focused: inputFocused } = useFocusable({
    focusKey: 'url-input',
    onEnterPress: () => {
      inputRef.current?.focus();
    },
  });

  const { ref: buttonRef, focused: buttonFocused } = useFocusable({
    focusKey: 'submit-button',
    onEnterPress: handleSubmit,
  });

  useEffect(() => {
    // Inicia sessão QR code (não foca no input para evitar teclado automático)
    startSession();
    // Focus on the input wrapper for spatial navigation (not the actual input)
    setFocus('url-input');

    return () => {
      stopSession();
    };
  }, []);

  function validateUrl(value: string): boolean {
    if (!value.trim()) {
      setError('Digite a URL da playlist');
      return false;
    }

    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('URL deve comecar com http:// ou https://');
        return false;
      }
    } catch {
      setError('URL invalida');
      return false;
    }

    setError('');
    return true;
  }

  function handleSubmit() {
    if (!validateUrl(url)) return;

    setPlaylistUrl(url);
    navigate('/onboarding/loading');
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  }, [url]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={containerRef} className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Adicionar Playlist</h1>
          <p className={styles.subtitle}>
            Digite a URL da sua playlist M3U ou escaneie o QR code com seu celular
          </p>
        </div>

        <div className={styles.content}>
          <div className={styles.form}>
            <div
              ref={inputFocusRef}
              className={`${styles.inputWrapper} ${inputFocused ? styles.focused : ''}`}
            >
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="http://exemplo.com/playlist.m3u"
                className={styles.input}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button
              ref={buttonRef}
              onClick={handleSubmit}
              className={`${styles.button} ${buttonFocused ? styles.focused : ''}`}
            >
              Carregar Playlist
            </button>
          </div>

          <div className={styles.divider}>
            <span>OU</span>
          </div>

          <div className={styles.qrSection}>
            <h2 className={styles.qrTitle}>Enviar do Celular</h2>
            <div className={styles.qrBox}>
              {qrLoading && (
                <div className={styles.qrLoading}>
                  <div className={styles.spinner} />
                  <p>Gerando QR code...</p>
                </div>
              )}

              {qrError && (
                <div className={styles.qrError}>
                  <p>⚠️ {qrError}</p>
                  <button onClick={startSession} className={styles.retryButton}>
                    Tentar novamente
                  </button>
                </div>
              )}

              {qrDataUrl && !qrError && (
                <>
                  <img src={qrDataUrl} alt="QR Code" className={styles.qrImage} />
                  {receivedUrl && (
                    <div className={styles.qrSuccess}>
                      ✓ URL recebida!
                    </div>
                  )}
                </>
              )}
            </div>
            <p className={styles.qrHint}>
              Escaneie com a câmera do celular
            </p>
          </div>
        </div>

        <div className={styles.help}>
          <p>Use as setas do controle para navegar</p>
          <p>Pressione OK/Enter para confirmar</p>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default PlaylistInput;
