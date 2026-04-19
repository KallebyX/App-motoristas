import { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { createPvtController, type PvtController } from '@app-motoristas/cognitive-tests';
import type { BlockResult } from '@app-motoristas/shared-types';
import { colors, styles } from '@/lib/theme';
import { addBlockResult } from '@/state/session-store';

// MVP PVT-B screen. Timing uses performance.now() which on Hermes is backed by
// a high-resolution timer. For production-grade precision, migrate the stimulus
// render + tap handler into a reanimated worklet (see plan.md risks).
export default function TestPvt() {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [stimulusVisible, setStimulusVisible] = useState(false);
  const [status, setStatus] = useState<'waiting' | 'go' | 'too_soon' | 'ok' | 'slow'>('waiting');
  const [elapsed, setElapsed] = useState(0);
  const controllerRef = useRef<PvtController | null>(null);
  const rafRef = useRef<number | null>(null);
  const startMsRef = useRef(0);

  useEffect(() => () => cancelTick(), []);

  function cancelTick() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function begin() {
    const c = createPvtController({
      block: 'pvt_b',
      totalDurationMs: 30_000,
      minIsiMs: 2_000,
      maxIsiMs: 6_000,
      stimulusTimeoutMs: 1_500,
      lapseThresholdMs: 500,
      falseStartWindowMs: 150,
    });
    controllerRef.current = c;

    c.subscribe((event) => {
      if (event.type === 'stimulus') {
        setStimulusVisible(true);
        setStatus('go');
      } else if (event.type === 'response') {
        setStimulusVisible(false);
        setStatus(event.trial.isLapse ? 'slow' : 'ok');
      } else if (event.type === 'miss') {
        setStimulusVisible(false);
        setStatus('slow');
      } else if (event.type === 'false_start') {
        setStatus('too_soon');
      } else if (event.type === 'awaiting') {
        setStatus('waiting');
      } else if (event.type === 'complete') {
        const result: BlockResult = event.result;
        addBlockResult(result);
        setPhase('done');
        cancelTick();
        router.replace('/(session)/subjective');
      }
    });

    setPhase('running');
    startMsRef.current = performance.now();
    c.start(startMsRef.current);

    const loop = () => {
      if (!controllerRef.current?.isRunning()) return;
      const now = performance.now();
      controllerRef.current.tick(now);
      setElapsed(now - startMsRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function onTap() {
    controllerRef.current?.onTap(performance.now());
  }

  if (phase === 'idle') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Teste de atenção</Text>
          <Text style={styles.subtitle}>
            Toque em qualquer lugar da tela assim que o círculo ficar verde. Aguarde o sinal —
            toques antes contam como erro.
          </Text>
          <TouchableOpacity style={styles.button} onPress={begin}>
            <Text style={styles.buttonText}>Começar (30 s)</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const remaining = Math.max(0, 30 - Math.floor(elapsed / 1000));

  return (
    <TouchableOpacity activeOpacity={1} onPress={onTap} style={styles.screen}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>Tempo restante</Text>
          <Text style={{ color: colors.text, fontSize: 32, fontWeight: '700' }}>{remaining}s</Text>
        </View>
        <View style={styles.center}>
          <View
            style={{
              width: 200,
              height: 200,
              borderRadius: 100,
              backgroundColor: stimulusVisible ? colors.green : colors.surface,
              borderWidth: 2,
              borderColor: colors.border,
            }}
          />
          <Text style={{ color: statusColor(status), marginTop: 24, fontSize: 16, fontWeight: '600' }}>
            {statusLabel(status)}
          </Text>
        </View>
      </SafeAreaView>
    </TouchableOpacity>
  );
}

function statusLabel(s: 'waiting' | 'go' | 'too_soon' | 'ok' | 'slow'): string {
  switch (s) {
    case 'waiting':
      return 'Aguarde o sinal…';
    case 'go':
      return 'TOQUE!';
    case 'ok':
      return 'Boa! Próximo vem em instantes…';
    case 'slow':
      return 'Resposta lenta — continue';
    case 'too_soon':
      return 'Toque antes do tempo — aguarde';
  }
}

function statusColor(s: ReturnType<typeof statusLabel> extends string ? Parameters<typeof statusLabel>[0] : never): string {
  switch (s) {
    case 'go':
      return colors.green;
    case 'too_soon':
    case 'slow':
      return colors.yellow;
    default:
      return colors.textMuted;
  }
}
