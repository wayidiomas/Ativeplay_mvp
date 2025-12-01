/**
 * Onboarding Store
 * Estado do fluxo de onboarding (stateless - backend faz o parsing)
 */

import { create } from 'zustand';

type OnboardingStep = 'splash' | 'input' | 'loading' | 'complete' | 'error';

interface OnboardingState {
  // Estado
  step: OnboardingStep;
  playlistUrl: string;
  errorMessage: string | null;

  // Actions
  setStep: (step: OnboardingStep) => void;
  setPlaylistUrl: (url: string) => void;
  setError: (message: string | null) => void;
  reset: () => void;
}

const initialState = {
  step: 'splash' as OnboardingStep,
  playlistUrl: '',
  errorMessage: null,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setPlaylistUrl: (playlistUrl) => set({ playlistUrl }),

  setError: (errorMessage) => set({ errorMessage, step: 'error' }),

  reset: () => set(initialState),
}));

export default useOnboardingStore;
