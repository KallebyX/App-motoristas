import { useEffect, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { colors, styles } from '@/lib/theme';

// Active liveness challenge: the driver must follow a random sequence of
// prompts (blink / turn head left / turn head right). In production this
// screen delegates capture + server-side match to the Unico / Idwall / Serpro
// SDK (see docs/antifraud-controls.md). The component below is a placeholder
// that records ~3s of video and advances — enough to wire the flow.
const PROMPTS = ['Olhe para frente', 'Pisque devagar', 'Vire o rosto para a direita'] as const;

export default function Liveness() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [currentPrompt, setCurrentPrompt] = useState(0);
  const [recording, setRecording] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (currentPrompt >= PROMPTS.length) {
      router.replace('/(session)/test-pvt');
    }
  }, [currentPrompt, router]);

  async function handleNext() {
    if (!cameraRef.current) return;
    if (!recording) {
      setRecording(true);
      // Production: cameraRef.current.recordAsync and upload to storage bucket.
      // For MVP, we just advance the prompt after a short delay.
      setTimeout(() => {
        setRecording(false);
        setCurrentPrompt((p) => p + 1);
      }, 1200);
    }
  }

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Acesso à câmera</Text>
          <Text style={styles.subtitle}>Precisamos da câmera para verificar sua identidade.</Text>
          <TouchableOpacity style={styles.button} onPress={() => requestPermission()}>
            <Text style={styles.buttonText}>Permitir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const prompt = PROMPTS[currentPrompt] ?? '';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ flex: 1, paddingVertical: 20 }}>
        <Text style={styles.title}>Verificação facial</Text>
        <Text style={styles.subtitle}>{prompt}</Text>
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: recording ? 3 : 1,
            borderColor: recording ? colors.red : colors.border,
            marginBottom: 24,
          }}
        >
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" mode="video" />
        </View>
        <TouchableOpacity
          style={[styles.button, { opacity: recording ? 0.5 : 1 }]}
          disabled={recording}
          onPress={handleNext}
        >
          <Text style={styles.buttonText}>{recording ? 'Capturando…' : 'Continuar'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
