import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, styles } from '@/lib/theme';
import { setSubjective } from '@/state/session-store';

// Karolinska Sleepiness Scale (1-9) + Samn-Perelli fatigue (1-7).
// Validated Portuguese translations available; the MVP inlines the short
// anchor labels. Full versions live at docs/scoring-methodology.md.
const KSS_LABELS: Record<number, string> = {
  1: 'Muito alerta',
  3: 'Alerta',
  5: 'Nem alerta nem sonolento',
  7: 'Sonolento — fazendo esforço',
  9: 'Extremamente sonolento',
};

const SAMN_LABELS: Record<number, string> = {
  1: 'Totalmente alerta',
  3: 'OK, mas um pouco cansado',
  5: 'Moderadamente cansado',
  7: 'Completamente exausto',
};

export default function Subjective() {
  const router = useRouter();
  const [kss, setKss] = useState<number | null>(null);
  const [sp, setSp] = useState<number | null>(null);

  function submit() {
    if (kss == null || sp == null) return;
    setSubjective({ kss, samnPerelli: sp });
    router.replace('/(session)/submit');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingVertical: 20 }}>
        <Text style={styles.title}>Como você está?</Text>
        <Text style={styles.subtitle}>Suas respostas entram no score — seja honesto.</Text>

        <Text style={sectionTitle}>Nível de sonolência</Text>
        <Scale count={9} selected={kss} onSelect={setKss} labels={KSS_LABELS} />

        <Text style={sectionTitle}>Nível de cansaço físico/mental</Text>
        <Scale count={7} selected={sp} onSelect={setSp} labels={SAMN_LABELS} />

        <TouchableOpacity
          style={[styles.button, { marginTop: 24, opacity: kss == null || sp == null ? 0.5 : 1 }]}
          disabled={kss == null || sp == null}
          onPress={submit}
        >
          <Text style={styles.buttonText}>Enviar respostas</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const sectionTitle = {
  color: colors.text,
  fontSize: 18,
  fontWeight: '600' as const,
  marginTop: 16,
  marginBottom: 12,
};

function Scale({
  count,
  selected,
  onSelect,
  labels,
}: {
  count: number;
  selected: number | null;
  onSelect: (n: number) => void;
  labels: Record<number, string>;
}) {
  const items = Array.from({ length: count }, (_, i) => i + 1);
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((n) => {
          const active = selected === n;
          return (
            <TouchableOpacity
              key={n}
              onPress={() => onSelect(n)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{n}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {selected != null && labels[selected] != null ? (
        <Text style={{ color: colors.textMuted, marginTop: 10, fontSize: 14 }}>
          {selected}: {labels[selected]}
        </Text>
      ) : null}
    </View>
  );
}
