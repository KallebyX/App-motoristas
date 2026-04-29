// Abstraction layer for biometric identity providers (Unico Check, Idwall,
// Serpro Datavalid). All provider credentials live exclusively on the server
// side — the mobile app only receives session tokens and talks to Supabase edge
// functions, which proxy requests to the real SDK. To swap providers, update
// the edge functions (biometric-liveness, verify-frame, unico-webhook) without
// touching this file.
//
// References:
//   docs/antifraud-controls.md — full control matrix
//   docs/lgpd-dpia.md         — biometric data handling under LGPD

import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from the liveness + face-match flow executed before each test. */
export interface LivenessResult {
  /** true when liveness score is above threshold and all prompts were completed. */
  passed: boolean;
  /** Provider similarity score 0–100 (threshold for auto-approve is 85 here, 90 for onboarding). */
  score: number;
  /** Opaque provider transaction ID, stored in the session for audit trail. */
  processId: string;
}

/** Result from a single frame reverification during the cognitive test. */
export interface FrameVerificationResult {
  /** Face similarity 0–1 compared to the enrolled driver template. */
  similarity: number;
  /** Opaque provider transaction ID for audit trail. */
  processId: string;
}

/** Result from enrolling a CNH photo during onboarding. */
export interface EnrollResult {
  /** ISO-8601 timestamp of submission. */
  submittedAt: string;
  /** Opaque provider transaction ID; also used by the unico-webhook callback. */
  providerTxId: string;
}

/**
 * Provider-agnostic interface. In production, wire up the real Unico / Idwall /
 * Serpro SDK inside BackendBiometricProvider (or replace with a native module
 * implementation). Credentials MUST stay on the server — never bundle them in
 * the app binary.
 */
export interface BiometricProvider {
  /**
   * Submit the driver's CNH photo for enrollment against the national database.
   * The provider will call back asynchronously via unico-webhook when done.
   */
  enrollCnh(driverId: string, cnhPhotoBase64: string): Promise<EnrollResult>;

  /**
   * Perform a liveness challenge for the given session.
   * The caller captures the image; this method submits it to the provider.
   */
  checkLiveness(sessionId: string, imageBase64: string): Promise<LivenessResult>;

  /**
   * Verify that the face in `frameBase64` matches the enrolled driver template.
   * Intended to be called fire-and-forget during the cognitive test; callers
   * should swallow thrown errors so as not to interrupt the test flow.
   */
  verifyFrame(sessionId: string, frameBase64: string): Promise<FrameVerificationResult>;
}

// ---------------------------------------------------------------------------
// Backend-proxied implementation
// ---------------------------------------------------------------------------
// All calls are routed through Supabase edge functions so that provider
// credentials (client_id / client_secret / webhook signing secret) are never
// bundled in the mobile app binary.

class BackendBiometricProvider implements BiometricProvider {
  async enrollCnh(driverId: string, cnhPhotoBase64: string): Promise<EnrollResult> {
    const { data, error } = await supabase.functions.invoke('biometric-liveness', {
      body: { action: 'enroll', driverId, cnhPhotoBase64 },
    });
    if (error) throw new Error(`CNH enrollment failed: ${error.message}`);
    return data as EnrollResult;
  }

  async checkLiveness(sessionId: string, imageBase64: string): Promise<LivenessResult> {
    const { data, error } = await supabase.functions.invoke('biometric-liveness', {
      body: { action: 'liveness', sessionId, imageBase64 },
    });
    if (error) throw new Error(`Liveness check failed: ${error.message}`);
    return data as LivenessResult;
  }

  async verifyFrame(sessionId: string, frameBase64: string): Promise<FrameVerificationResult> {
    const { data, error } = await supabase.functions.invoke('verify-frame', {
      body: { sessionId, frameBase64 },
    });
    if (error) throw new Error(`Frame verification failed: ${error.message}`);
    return data as FrameVerificationResult;
  }
}

let _provider: BiometricProvider | null = null;

/** Returns the configured biometric provider singleton. */
export function getBiometricProvider(): BiometricProvider {
  if (!_provider) _provider = new BackendBiometricProvider();
  return _provider;
}
