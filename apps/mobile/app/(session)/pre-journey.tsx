import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, styles } from '@/lib/theme';

export default function PreJourney() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.title}>Pronto para iniciar?</Text>
        <Text style={styles.subtitle}>
          O teste leva cerca de 90 segundos: verificação facial, 3 desafios rápidos e 2 perguntas sobre seu sono.
        </Text>

        <View style={[styles.card, { width: '100%', marginBottom: 24 }]}>
          <Step n={1} title="Verificação facial" desc="Confirmamos sua identidade contra a CNH." />
          <Step n={2} title="Teste de atenção" desc="Toque rápido quando o círculo acender." />
          <Step n={3} title="Questionário rápido" desc="Como está seu sono e cansaço hoje?" />
        </View>

        <TouchableOpacity style={styles.button} onPress={() => router.push('/(session)/liveness')}>
          <Text style={styles.buttonText}>Começar</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 14, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>{desc}</Text>
      </View>
    </View>
  );
}
