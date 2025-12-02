/**
 * AccountInfo - Displays Xtream account subscription info
 * Shows expiration date, max connections, trial status
 * Supports D-PAD navigation for TV remotes
 */

import { useEffect, useState, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { usePlaylistStore } from '@store/playlistStore';
import type { XtreamPlaylistInfo } from '@core/services/api/xtream';
import {
  MdArrowBack,
  MdPerson,
  MdAccessTime,
  MdDevices,
  MdWarning,
  MdCheckCircle,
  MdError,
  MdLogout,
} from 'react-icons/md';
import styles from './AccountInfo.module.css';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format expiration date
 */
function formatExpirationDate(timestamp?: number): string {
  if (!timestamp) return 'Desconhecido';

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Calculate days until expiration
 */
function getDaysUntilExpiration(timestamp?: number): number | null {
  if (!timestamp) return null;

  const now = Date.now();
  const expDate = timestamp * 1000;
  const diffMs = expDate - now;

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get expiration status
 */
function getExpirationStatus(daysLeft: number | null): 'expired' | 'warning' | 'ok' {
  if (daysLeft === null) return 'ok';
  if (daysLeft <= 0) return 'expired';
  if (daysLeft <= 7) return 'warning';
  return 'ok';
}

// ============================================================================
// Focusable Button Component
// ============================================================================

interface ActionButtonProps {
  focusKey: string;
  icon: React.ReactNode;
  label: string;
  variant?: 'primary' | 'danger';
  onPress: () => void;
  onArrowPress?: (direction: string) => boolean;
}

const ActionButton = memo(function ActionButton({
  focusKey,
  icon,
  label,
  variant = 'primary',
  onPress,
  onArrowPress,
}: ActionButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress,
  });

  return (
    <button
      ref={ref}
      className={`${styles.actionButton} ${styles[variant]} ${focused ? styles.focused : ''}`}
      onClick={onPress}
      tabIndex={-1}
      data-focused={focused}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

// ============================================================================
// Info Card Component
// ============================================================================

interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: 'ok' | 'warning' | 'expired';
  subValue?: string;
}

const InfoCard = memo(function InfoCard({
  icon,
  label,
  value,
  status = 'ok',
  subValue,
}: InfoCardProps) {
  return (
    <div className={`${styles.infoCard} ${styles[status]}`}>
      <div className={styles.infoIcon}>{icon}</div>
      <div className={styles.infoContent}>
        <span className={styles.infoLabel}>{label}</span>
        <span className={styles.infoValue}>{value}</span>
        {subValue && <span className={styles.infoSubValue}>{subValue}</span>}
      </div>
      {status === 'warning' && <MdWarning className={styles.statusIcon} />}
      {status === 'expired' && <MdError className={styles.statusIcon} />}
      {status === 'ok' && <MdCheckCircle className={styles.statusIconOk} />}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export function AccountInfo() {
  const navigate = useNavigate();

  // Store
  const isXtream = usePlaylistStore((s) => s.isXtream);
  const getXtreamClient = usePlaylistStore((s) => s.getXtreamClient);
  const resetPlaylist = usePlaylistStore((s) => s.reset);

  // State
  const [accountInfo, setAccountInfo] = useState<XtreamPlaylistInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Page focus context
  const { ref: pageRef, focusKey: pageFocusKey } = useFocusable({
    focusKey: 'account-info-page',
    isFocusBoundary: true,
    saveLastFocusedChild: true,
  });

  // Back button
  const { ref: backRef, focused: backFocused } = useFocusable({
    focusKey: 'account-back',
    onEnterPress: () => navigate(-1),
  });

  // Load account info
  useEffect(() => {
    async function loadAccountInfo() {
      if (!isXtream()) {
        setError('Informações de conta disponíveis apenas para playlists Xtream');
        setLoading(false);
        return;
      }

      const client = getXtreamClient();
      if (!client) {
        setError('Cliente Xtream não disponível');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const info = await client.getInfo();
        setAccountInfo(info);

      } catch (err) {
        console.error('[AccountInfo] Failed to load account info:', err);
        setError('Falha ao carregar informações da conta');
      } finally {
        setLoading(false);
      }
    }

    loadAccountInfo();
  }, [isXtream, getXtreamClient]);

  // Handle logout
  const handleLogout = useCallback(() => {
    resetPlaylist();
    navigate('/');
  }, [resetPlaylist, navigate]);

  // Navigation handlers
  const handleLogoutArrowPress = useCallback((direction: string): boolean => {
    if (direction === 'up') {
      setFocus('account-back');
      return false;
    }
    return false;
  }, []);

  // Set initial focus
  useEffect(() => {
    if (!loading) {
      setFocus('account-back');
    }
  }, [loading]);

  // Derived values
  const daysLeft = getDaysUntilExpiration(accountInfo?.expiresAt);
  const expirationStatus = getExpirationStatus(daysLeft);

  // Loading state
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Carregando informações...</span>
        </div>
      </div>
    );
  }

  // Error state for non-Xtream
  if (error && !accountInfo) {
    return (
      <FocusContext.Provider value={pageFocusKey}>
        <div ref={pageRef} className={styles.container}>
          <div className={styles.header}>
            <button
              ref={backRef}
              className={`${styles.backButton} ${backFocused ? styles.focused : ''}`}
              onClick={() => navigate(-1)}
              data-focused={backFocused}
            >
              <MdArrowBack size={24} />
              <span>Voltar</span>
            </button>
          </div>
          <div className={styles.error}>
            <MdWarning size={48} />
            <p>{error}</p>
          </div>
        </div>
      </FocusContext.Provider>
    );
  }

  return (
    <FocusContext.Provider value={pageFocusKey}>
      <div ref={pageRef} className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <button
            ref={backRef}
            className={`${styles.backButton} ${backFocused ? styles.focused : ''}`}
            onClick={() => navigate(-1)}
            data-focused={backFocused}
            onKeyDown={() => {}}
          >
            <MdArrowBack size={24} />
            <span>Voltar</span>
          </button>
          <h1 className={styles.title}>Informações da Conta</h1>
        </div>

        {/* Account Info Cards */}
        <div className={styles.content}>
          {/* Server Info */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Servidor</h2>
            <div className={styles.infoGrid}>
              <InfoCard
                icon={<MdPerson />}
                label="Usuário"
                value={accountInfo?.username || 'N/A'}
              />
              <InfoCard
                icon={<MdDevices />}
                label="Servidor"
                value={accountInfo?.server?.replace(/^https?:\/\//, '') || 'N/A'}
              />
            </div>
          </div>

          {/* Subscription Info */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Assinatura</h2>
            <div className={styles.infoGrid}>
              <InfoCard
                icon={<MdAccessTime />}
                label="Expira em"
                value={formatExpirationDate(accountInfo?.expiresAt)}
                status={expirationStatus}
                subValue={
                  daysLeft !== null
                    ? daysLeft > 0
                      ? `${daysLeft} dias restantes`
                      : 'Expirado'
                    : undefined
                }
              />
              <InfoCard
                icon={<MdDevices />}
                label="Conexões"
                value={accountInfo?.maxConnections?.toString() || 'Ilimitado'}
              />
            </div>

            {/* Trial Badge */}
            {accountInfo?.isTrial && (
              <div className={styles.trialBadge}>
                <MdWarning />
                <span>Conta de Teste</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            <ActionButton
              focusKey="account-logout"
              icon={<MdLogout size={20} />}
              label="Trocar Playlist"
              variant="danger"
              onPress={handleLogout}
              onArrowPress={handleLogoutArrowPress}
            />
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default AccountInfo;
