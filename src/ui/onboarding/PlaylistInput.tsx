/**
 * PlaylistInput
 * Tela para entrada da URL da playlist M3U
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useFocusable,
  FocusContext,
} from '@noriginmedia/norigin-spatial-navigation';
import { useOnboardingStore } from '@store/onboardingStore';
import styles from './PlaylistInput.module.css';

export function PlaylistInput() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const setPlaylistUrl = useOnboardingStore((s) => s.setPlaylistUrl);

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
    // Foca no input ao montar
    inputRef.current?.focus();
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
            Digite a URL da sua playlist M3U para comecar
          </p>
        </div>

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

        <div className={styles.help}>
          <p>Use as setas do controle para navegar</p>
          <p>Pressione OK/Enter para confirmar</p>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default PlaylistInput;
