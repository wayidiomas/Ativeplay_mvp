/**
 * Onboarding Store
 * Estado do fluxo de onboarding
 */

import { create } from 'zustand';
import type { ParserProgress } from '@core/services/m3u';

type OnboardingStep = 'splash' | 'input' | 'loading' | 'complete' | 'error';

interface OnboardingState {
  // Estado
  step: OnboardingStep;
  playlistUrl: string;
  progress: ParserProgress | null;
  errorMessage: string | null;

  // Actions
  setStep: (step: OnboardingStep) => void;
  setPlaylistUrl: (url: string) => void;
  setProgress: (progress: ParserProgress | null) => void;
  setError: (message: string | null) => void;
  reset: () => void;
}

const initialState = {
  step: 'splash' as OnboardingStep,
  playlistUrl: '',
  progress: null,
  errorMessage: null,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setPlaylistUrl: (playlistUrl) => set({ playlistUrl }),

  setProgress: (progress) => set({ progress }),

  setError: (errorMessage) => set({ errorMessage, step: 'error' }),

  reset: () => set(initialState),
}));

export default useOnboardingStore;
