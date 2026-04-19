import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import type { SessionScore } from '@app-motoristas/shared-types';
import { colors, styles } from '@/lib/theme';
import { clearDraft, getDraft } from '@/state/session-store';
import { supabase } from '@/lib/supabase';
import { getDeviceFingerprint } from '@/lib/device';

export default function Submit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<SessionScore | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const draft = getDraft();
        if (!draft.subjective || draft.blocks.length === 0) {
          throw new Error('Dados da sessão incompletos.');
        }

        const { data: userRes } = await supabase.auth.getUser();
        if (!userRes.user) throw new Error('Sessão expirada — faça login novamente.');

        let geo: { lat: number; lng: number; accuracyM?: number } | null = null;
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? undefined };
        }

        const submission = {
          sessionId: draft.sessionId,
          driverId: userRes.user.id,
          startedAt: draft.startedAt,
          completedAt: new Date().toISOString(),
          deviceFingerprint: await getDeviceFingerprint(),
          appVersion: Constants.expoConfig?.version ?? '0.0.0',
          geo,
          livenessVideoRef: draft.livenessVideoRef ?? null,
          livenessMatchScore: null,
          blocks: draft.blocks,
          subjective: draft.subjective,
        };

        const { data, error: invokeError } = await supabase.functions.invoke<SessionScore>(
          'compute-session-score',
          { body: submission },
        );
        if (invokeError || !data) throw invokeError ?? new Error('Falha ao calcular score.');
        setScore(data);
        clearDraft();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={[styles.title, { color: colors.red }]}>Erro ao enviar</Text>
          <Text style={styles.subtitle}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!score) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.subtitle, { marginTop: 16 }]}>Calculando sua prontidão…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const lightColor =
    score.trafficLight === 'green' ? colors.green : score.trafficLight === 'yellow' ? colors.yellow : colors.red;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <View
          style={{
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: lightColor,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 52, fontWeight: '800' }}>{Math.round(score.finalScore)}</Text>
        </View>
        <Text style={styles.title}>{trafficLabel(score.trafficLight)}</Text>
        <Text style={styles.subtitle}>
          {score.blocked
            ? 'Sua jornada foi bloqueada pela política da empresa. Fale com o supervisor.'
            : 'Boa jornada! Dirija com segurança.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function trafficLabel(l: 'green' | 'yellow' | 'red'): string {
  if (l === 'green') return 'Apto para a jornada';
  if (l === 'yellow') return 'Atenção — prontidão reduzida';
  return 'Prontidão crítica';
}
