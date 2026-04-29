// Thin abstraction over whichever biometric SaaS we integrate.
// Implementing a single interface lets us swap Unico / Idwall / Serpro without
// touching the session flow. Each `verify` call must POST to a **backend**
// endpoint that holds the provider secret — the SDK is the UI only, never
// credentials. See docs/antifraud-controls.md for the full threat model.

import type { CameraCapturedPicture } from 'expo-camera';

export interface OnboardingVerification {
  matchScore: number; // 0-100 similarity vs CNH photo
  livenessPassed: boolean;
  providerTxId: string; // provider's transaction id for auditing
}

export interface LivenessChallenge {
  videoRef: string; // bucket object key (uploaded by the provider SDK)
  matchScore: number; // 0-100 similarity vs enrollment photo
  livenessPassed: boolean;
  providerTxId: string;
}

export interface BiometricProvider {
  runOnboardingMatch(input: {
    driverId: string;
    cnhNumber: string;
    cpf: string;
  }): Promise<OnboardingVerification>;
  runLivenessChallenge(input: { driverId: string; sessionId: string }): Promise<LivenessChallenge>;
  runSilentReverify(input: { driverId: string; sessionId: string }): Promise<{
    matchScore: number;
    providerTxId: string;
  }>;
}

// Capture callbacks injected by the mobile UI — the on-device provider uses
// them to own the camera lifecycle; commercial providers (Unico etc) ignore
// them and delegate to their own SDK.
export interface CameraCaptureAdapters {
  captureOnboarding: () => Promise<CameraCapturedPicture>;
  captureForPrompt: (prompt: string, attempt: number) => Promise<CameraCapturedPicture>;
}

export async function getBiometricProvider(
  adapters?: CameraCaptureAdapters,
): Promise<BiometricProvider> {
  const name = process.env.EXPO_PUBLIC_BIOMETRIC_PROVIDER ?? 'stub';
  switch (name) {
    case 'on-device': {
      if (!adapters) throw new Error('on-device provider requires CameraCaptureAdapters');
      const { createOnDeviceProvider } = await import('./providers/on-device');
      return createOnDeviceProvider(adapters);
    }
    case 'unico':
      // TODO(#4): return (await import('./providers/unico')).UnicoProvider once contracted.
      return stubProvider;
    case 'idwall':
    case 'serpro':
      // TODO(#4): commercial implementations.
      return stubProvider;
    default:
      return stubProvider;
  }
}

const stubProvider: BiometricProvider = {
  async runOnboardingMatch() {
    warnStub('runOnboardingMatch');
    return { matchScore: 99, livenessPassed: true, providerTxId: `stub-${Date.now()}` };
  },
  async runLivenessChallenge({ sessionId }) {
    warnStub('runLivenessChallenge');
    return {
      videoRef: `liveness-videos/${sessionId}.mp4`,
      matchScore: 99,
      livenessPassed: true,
      providerTxId: `stub-${sessionId}`,
    };
  },
  async runSilentReverify() {
    return { matchScore: 99, providerTxId: `stub-${Date.now()}` };
  },
};

const warned = new Set<string>();
function warnStub(method: string) {
  if (warned.has(method)) return;
  warned.add(method);
  console.warn(`[biometric] using STUB provider for ${method} — see issue #4`);
}
