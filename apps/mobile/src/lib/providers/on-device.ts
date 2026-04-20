// On-device biometric provider. Uses expo-face-detector (ML Kit under the
// hood) to implement real liveness challenges without any paid SaaS.
//
// Trade-offs:
//  - NO match against the CNH photo (no access to the Detran base). We store
//    the enrollment selfie in Supabase Storage (private bucket) and trust the
//    empresa's onboarding process for identity verification.
//  - Liveness is challenge-response: the UI shows a random sequence of
//    prompts (smile / blink / turn head) and the detector verifies each.
//  - Good enough for the 30-day shadow pilot. When the Unico / Idwall
//    contract closes, swap this file for providers/unico.ts behind the same
//    interface — no caller changes required.

import type { CameraCapturedPicture } from 'expo-camera';
import type { FaceFeature } from 'expo-face-detector';
import * as FaceDetector from 'expo-face-detector';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../supabase';
import type {
  BiometricProvider,
  LivenessChallenge,
  OnboardingVerification,
} from '../biometric-provider';

export type LivenessPrompt = 'smile' | 'blink' | 'turn_left' | 'turn_right';

export const DEFAULT_PROMPT_SEQUENCE: LivenessPrompt[] = ['smile', 'blink', 'turn_right'];

export interface LivenessCheckResult {
  prompt: LivenessPrompt;
  passed: boolean;
  face: FaceFeature | null;
}

// Thresholds tuned against ML Kit typical output values.
const THRESHOLDS = {
  smilingProbability: 0.7,
  eyeClosedProbability: 0.6, // eyes closed → blink
  turnDegrees: 20, // |yawAngle| threshold for turn left/right
};

/**
 * Detect a single face in an image and return its features.
 * Returns null when 0 or >1 faces are found (safer for our use case).
 */
export async function detectFace(imageUri: string): Promise<FaceFeature | null> {
  const result = await FaceDetector.detectFacesAsync(imageUri, {
    mode: FaceDetector.FaceDetectorMode.accurate,
    detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
    runClassifications: FaceDetector.FaceDetectorClassifications.all,
  });
  return result.faces.length === 1 ? result.faces[0]! : null;
}

/**
 * Evaluate whether a given photo satisfies a liveness prompt.
 * All checks are pure — caller decides what to do with the result.
 */
export function evaluatePrompt(
  prompt: LivenessPrompt,
  face: FaceFeature | null,
): boolean {
  if (!face) return false;
  const yaw = face.yawAngle ?? 0;
  const smile = face.smilingProbability ?? 0;
  const leftEyeOpen = face.leftEyeOpenProbability ?? 1;
  const rightEyeOpen = face.rightEyeOpenProbability ?? 1;
  switch (prompt) {
    case 'smile':
      return smile >= THRESHOLDS.smilingProbability;
    case 'blink':
      return (
        leftEyeOpen <= 1 - THRESHOLDS.eyeClosedProbability &&
        rightEyeOpen <= 1 - THRESHOLDS.eyeClosedProbability
      );
    case 'turn_left':
      return yaw < -THRESHOLDS.turnDegrees;
    case 'turn_right':
      return yaw > THRESHOLDS.turnDegrees;
  }
}

export async function checkPrompt(
  prompt: LivenessPrompt,
  imageUri: string,
): Promise<LivenessCheckResult> {
  const face = await detectFace(imageUri);
  return { prompt, face, passed: evaluatePrompt(prompt, face) };
}

// --- Provider implementation ---

async function uploadEnrollment(driverId: string, imageUri: string): Promise<string> {
  const bytes = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const path = `${driverId}/enrollment-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('cnh-photos')
    .upload(path, decodeBase64(bytes), { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`enrollment upload failed: ${error.message}`);
  return path;
}

async function uploadLivenessShot(
  sessionId: string,
  index: number,
  imageUri: string,
): Promise<string> {
  const bytes = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const path = `${sessionId}/liveness-${index}.jpg`;
  const { error } = await supabase.storage
    .from('liveness-videos')
    .upload(path, decodeBase64(bytes), { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`liveness upload failed: ${error.message}`);
  return path;
}

function decodeBase64(b64: string): ArrayBuffer {
  const binary = globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const len = binary.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

/**
 * Factory that returns a BiometricProvider backed by expo-face-detector.
 * Captures are taken by the caller (the liveness screen owns the camera);
 * the provider receives photo URIs and handles detection + storage upload.
 */
export function createOnDeviceProvider(options?: {
  captureOnboarding: () => Promise<CameraCapturedPicture>;
  captureForPrompt: (prompt: LivenessPrompt, attempt: number) => Promise<CameraCapturedPicture>;
  promptSequence?: LivenessPrompt[];
  maxAttemptsPerPrompt?: number;
}): BiometricProvider {
  const seq = options?.promptSequence ?? DEFAULT_PROMPT_SEQUENCE;
  const maxAttempts = options?.maxAttemptsPerPrompt ?? 3;
  return {
    async runOnboardingMatch({ driverId }) {
      if (!options?.captureOnboarding) {
        throw new Error('captureOnboarding callback is required');
      }
      const photo = await options.captureOnboarding();
      const face = await detectFace(photo.uri);
      if (!face) throw new Error('no face detected in enrollment photo');
      const ref = await uploadEnrollment(driverId, photo.uri);
      return {
        matchScore: 100, // no CNH match locally; trust the enrollment
        livenessPassed: true,
        providerTxId: `on-device:${ref}`,
      } satisfies OnboardingVerification;
    },

    async runLivenessChallenge({ sessionId }) {
      if (!options?.captureForPrompt) {
        throw new Error('captureForPrompt callback is required');
      }
      const results: LivenessCheckResult[] = [];
      let lastPhoto: CameraCapturedPicture | null = null;
      for (let i = 0; i < seq.length; i++) {
        const prompt = seq[i]!;
        let passed = false;
        for (let attempt = 0; attempt < maxAttempts && !passed; attempt++) {
          const photo = await options.captureForPrompt(prompt, attempt);
          lastPhoto = photo;
          const check = await checkPrompt(prompt, photo.uri);
          results.push(check);
          passed = check.passed;
        }
        if (!passed) {
          return {
            videoRef: '',
            matchScore: 0,
            livenessPassed: false,
            providerTxId: `on-device:${sessionId}:failed-${prompt}`,
          } satisfies LivenessChallenge;
        }
      }
      let videoRef = '';
      if (lastPhoto) {
        videoRef = await uploadLivenessShot(sessionId, seq.length - 1, lastPhoto.uri);
      }
      return {
        videoRef,
        matchScore: 100,
        livenessPassed: true,
        providerTxId: `on-device:${sessionId}:ok`,
      } satisfies LivenessChallenge;
    },

    async runSilentReverify({ sessionId }) {
      // On-device we don't continuously stream — this is a no-op for MVP.
      return { matchScore: 100, providerTxId: `on-device:${sessionId}:silent` };
    },
  };
}
