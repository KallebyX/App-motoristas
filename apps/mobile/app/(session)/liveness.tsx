import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import { useRouter } from 'expo-router';
import {
  DEFAULT_PROMPT_SEQUENCE,
  checkPrompt,
  type LivenessPrompt,
} from '@/lib/providers/on-device';
import { getDraft, setLivenessRef } from '@/state/session-store';
import { colors, styles } from '@/lib/theme';

const PROMPT_LABELS: Record<LivenessPrompt, string> = {
  smile: 'Sorria para a câmera 😊',
  blink: 'Pisque os olhos devagar',
  turn_left: 'Vire a cabeça para a esquerda',
  turn_right: 'Vire a cabeça para a direita',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'prompt'; index: number; attempt: number; hint?: string }
  | { kind: 'checking' }
  | { kind: 'done' }
  | { kind: 'failed'; reason: string };

const MAX_ATTEMPTS = 3;

export default function Liveness() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  async function capture(): Promise<CameraCapturedPicture | null> {
    if (!cameraRef.current) return null;
    return cameraRef.current.takePictureAsync({
      quality: 0.6,
      skipProcessing: true,
      base64: false,
    });
  }

  async function runSequence() {
    setPhase({ kind: 'prompt', index: 0, attempt: 0 });
    const seq = DEFAULT_PROMPT_SEQUENCE;
    for (let i = 0; i < seq.length; i++) {
      const prompt = seq[i]!;
      let passed = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !passed; attempt++) {
        setPhase({ kind: 'prompt', index: i, attempt });
        await sleep(1500);
        setPhase({ kind: 'checking' });
        const photo = await capture();
        if (!photo) {
          setPhase({ kind: 'failed', reason: 'câmera indisponível' });
          return;
        }
        const result = await checkPrompt(prompt, photo.uri);
        passed = result.passed;
        if (!passed) {
          setPhase({
            kind: 'prompt',
            index: i,
            attempt: attempt + 1,
            hint: result.face ? 'Tente novamente com mais ênfase.' : 'Rosto não detectado — enquadre melhor.',
          });
        }
      }
      if (!passed) {
        setPhase({ kind: 'failed', reason: `não consegui validar "${PROMPT_LABELS[prompt]}"` });
        return;
      }
    }
    const draft = getDraft();
    setLivenessRef(`local:${draft.sessionId}:ok`);
    setPhase({ kind: 'done' });
    router.replace('/(session)/test-pvt');
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

  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ flex: 1, paddingVertical: 20 }}>
        <Text style={styles.title}>Verificação facial</Text>
        <Body phase={phase} />
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: phase.kind === 'checking' ? 3 : 1,
            borderColor: phase.kind === 'checking' ? colors.yellow : colors.border,
            marginVertical: 20,
          }}
        >
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />
        </View>
        {phase.kind === 'idle' ? (
          <TouchableOpacity style={styles.button} onPress={runSequence}>
            <Text style={styles.buttonText}>Começar</Text>
          </TouchableOpacity>
        ) : null}
        {phase.kind === 'failed' ? (
          <TouchableOpacity style={styles.button} onPress={() => setPhase({ kind: 'idle' })}>
            <Text style={styles.buttonText}>Tentar de novo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Body({ phase }: { phase: Phase }) {
  if (phase.kind === 'idle') {
    return (
      <Text style={styles.subtitle}>
        Vamos fazer 3 verificações rápidas. Mantenha o rosto bem iluminado e dentro do quadro.
      </Text>
    );
  }
  if (phase.kind === 'prompt') {
    const seq = DEFAULT_PROMPT_SEQUENCE;
    const prompt = seq[phase.index]!;
    return (
      <View>
        <Text style={[styles.subtitle, { fontSize: 18, color: colors.text, fontWeight: '600' }]}>
          {phase.index + 1}/{seq.length} · {PROMPT_LABELS[prompt]}
        </Text>
        {phase.hint ? (
          <Text style={[styles.subtitle, { color: colors.yellow, marginTop: 4 }]}>{phase.hint}</Text>
        ) : null}
      </View>
    );
  }
  if (phase.kind === 'checking') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator color={colors.yellow} />
        <Text style={styles.subtitle}>Analisando rosto…</Text>
      </View>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <Text style={[styles.subtitle, { color: colors.red }]}>Falha na verificação: {phase.reason}</Text>
    );
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
