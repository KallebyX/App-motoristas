import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Stable per-install device fingerprint. Combines OS install id + hardware
// string + app id and hashes, so the raw installation id never leaves the
// device unhashed. Used for device binding + anti-fraud telemetry.
export async function getDeviceFingerprint(): Promise<string> {
  const installId =
    Platform.OS === 'android'
      ? await Application.getAndroidId()
      : await Application.getIosIdForVendorAsync();
  const parts = [
    installId ?? 'unknown-install',
    Device.modelName ?? 'unknown-model',
    Device.osName ?? Platform.OS,
    Device.osVersion ?? 'unknown-os',
    Application.applicationId ?? 'unknown-app',
  ];
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, parts.join('|'));
}
