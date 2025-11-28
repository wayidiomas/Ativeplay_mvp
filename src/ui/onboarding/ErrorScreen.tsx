/**
 * ErrorScreen
 * Tela de erro no carregamento da playlist
 */

import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '@store/onboardingStore';
import styles from './ErrorScreen.module.css';

export function ErrorScreen() {
  const navigate = useNavigate();
  const { errorMessage, reset } = useOnboardingStore();

  const { ref: containerRef, focusKey } = useFocusable({
    focusKey: 'error-screen',
    isFocusBoundary: true,
  });

  const { ref: retryRef, focused: retryFocused } = useFocusable({
    focusKey: 'retry-button',
    onEnterPress: handleRetry,
  });

  const { ref: changeRef, focused: changeFocused } = useFocusable({
    focusKey: 'change-button',
    onEnterPress: handleChangeUrl,
  });

  function handleRetry() {
    navigate('/onboarding/loading');
  }

  function handleChangeUrl() {
    reset();
    navigate('/onboarding/input');
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={containerRef} className={styles.container}>
        <div className={styles.content}>
          <div className={styles.iconWrapper}>
            <svg viewBox="0 0 24 24" className={styles.icon}>
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>

          <h1 className={styles.title}>Erro ao Carregar</h1>
          <p className={styles.message}>
            {errorMessage || 'Nao foi possivel carregar a playlist'}
          </p>

          <div className={styles.buttons}>
            <button
              ref={retryRef}
              onClick={handleRetry}
              className={`${styles.button} ${styles.primary} ${retryFocused ? styles.focused : ''}`}
            >
              Tentar Novamente
            </button>
            <button
              ref={changeRef}
              onClick={handleChangeUrl}
              className={`${styles.button} ${styles.secondary} ${changeFocused ? styles.focused : ''}`}
            >
              Alterar URL
            </button>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default ErrorScreen;
