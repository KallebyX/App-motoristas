// Thin abstraction over whichever biometric SaaS we integrate.
// Implementing a single interface lets us swap Unico / Idwall / Serpro without
// touching the session flow. Each `verify` call must POST to a **backend**
// endpoint that holds the provider secret — the SDK is the UI only, never
// credentials. See docs/antifraud-controls.md for the full threat model.

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
  /**
   * Onboarding: match the driver's live selfie against the CNH photo in the
   * provider's reference database. Returns a similarity score; caller decides
   * what to do with the value (>=90 auto-approve, 80-89 manual review).
   */
  runOnboardingMatch(input: {
    driverId: string;
    cnhNumber: string;
    cpf: string;
  }): Promise<OnboardingVerification>;

  /**
   * Pre-journey liveness: random prompt sequence (blink / turn head) to prove
   * the person is physically present and alive. Typically ~6-8s.
   */
  runLivenessChallenge(input: { driverId: string; sessionId: string }): Promise<LivenessChallenge>;

  /**
   * Silent re-verification during the cognitive test — captures a single frame
   * and compares against enrollment. Fire-and-forget from the UI perspective.
   */
  runSilentReverify(input: { driverId: string; sessionId: string }): Promise<{
    matchScore: number;
    providerTxId: string;
  }>;
}

// Picks the concrete implementation based on EXPO_PUBLIC_BIOMETRIC_PROVIDER.
// Individual implementations live in `providers/` — today only the stub is
// wired so the mobile app builds end-to-end before vendor lock-in decisions.
export async function getBiometricProvider(): Promise<BiometricProvider> {
  const name = process.env.EXPO_PUBLIC_BIOMETRIC_PROVIDER ?? 'stub';
  switch (name) {
    case 'unico':
      // TODO(#4): replace once @unico-check/react-native is contracted.
      //   return (await import('./providers/unico')).UnicoProvider;
      return stubProvider;
    case 'idwall':
      // TODO(#4): idwall implementation.
      return stubProvider;
    case 'serpro':
      // TODO(#4): serpro implementation (may need Idwall as integrator).
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

let warned = new Set<string>();
function warnStub(method: string) {
  if (warned.has(method)) return;
  warned.add(method);
  // eslint-disable-next-line no-console
  console.warn(`[biometric] using STUB provider for ${method} — see issue #4`);
}
