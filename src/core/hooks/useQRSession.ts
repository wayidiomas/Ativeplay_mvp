/**
 * useQRSession
 * Hook para gerenciar sessão de QR code e polling de URL enviada pelo celular
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// URL do servidor bridge (usar variável de ambiente em produção)
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:3001';

interface QRSession {
  sessionId: string;
  qrDataUrl: string;
  mobileUrl: string;
  expiresAt: number;
}

interface UseQRSessionReturn {
  qrDataUrl: string | null;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  receivedUrl: string | null;
  startSession: () => Promise<void>;
  stopSession: () => void;
}

/**
 * Hook que gerencia sessão de QR code para receber URL do celular
 *
 * @param onUrlReceived Callback chamado quando URL é recebida do celular
 * @returns Estado da sessão e funções de controle
 */
export function useQRSession(onUrlReceived?: (url: string) => void): UseQRSessionReturn {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivedUrl, setReceivedUrl] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);

  /**
   * Inicia polling para verificar se URL foi enviada
   */
  const startPolling = useCallback((sessionId: string) => {
    // Limpa polling anterior se existir
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Faz polling a cada 2 segundos
    pollingIntervalRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(`${BRIDGE_URL}/session/${sessionId}/poll`);

        if (!response.ok) {
          if (response.status === 404) {
            // Sessão expirou
            console.warn('[QRSession] Sessão expirou');
            stopSession();
            setError('Sessão expirada. Gere um novo QR code.');
            return;
          }
          throw new Error('Erro ao consultar sessão');
        }

        const data = await response.json();

        if (data.received && data.url) {
          console.log('[QRSession] URL recebida:', data.url);
          setReceivedUrl(data.url);
          stopSession(); // Para polling
          onUrlReceived?.(data.url); // Notifica callback
        }
      } catch (err) {
        console.error('[QRSession] Erro no polling:', err);
        // Não para o polling por erro de rede temporário
      }
    }, 2000);
  }, [onUrlReceived]);

  /**
   * Inicia nova sessão de QR code
   */
  const startSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setReceivedUrl(null);

    try {
      const response = await fetch(`${BRIDGE_URL}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Erro ao criar sessão');
      }

      const session: QRSession = await response.json();

      sessionIdRef.current = session.sessionId;
      setQrDataUrl(session.qrDataUrl);
      setIsActive(true);

      console.log('[QRSession] Sessão criada:', session.sessionId);
      console.log('[QRSession] URL mobile:', session.mobileUrl);

      // Inicia polling
      startPolling(session.sessionId);
    } catch (err) {
      console.error('[QRSession] Erro ao criar sessão:', err);
      setError('Erro ao gerar QR code. Verifique sua conexão.');
    } finally {
      setIsLoading(false);
    }
  }, [startPolling]);

  /**
   * Para sessão e limpa polling
   */
  const stopSession = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    sessionIdRef.current = null;
    setQrDataUrl(null);
    setIsActive(false);

    console.log('[QRSession] Sessão encerrada');
  }, []);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  return {
    qrDataUrl,
    isActive,
    isLoading,
    error,
    receivedUrl,
    startSession,
    stopSession,
  };
}
