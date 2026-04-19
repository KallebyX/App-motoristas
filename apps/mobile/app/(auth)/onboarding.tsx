import { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, styles } from '@/lib/theme';

// Simplified onboarding for MVP: SMS-based login via Supabase Phone Auth.
// The full flow also captures a CNH photo and posts to the biometric provider
// (Unico / Idwall / Serpro) via a secure backend endpoint — see
// supabase/functions/unico-webhook/index.ts for the server-side match.
export default function Onboarding() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) Alert.alert('Erro', error.message);
    else setStep('code');
  }

  async function verifyOtp() {
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    setLoading(false);
    if (error) {
      Alert.alert('Erro', error.message);
      return;
    }
    // Next: kick off biometric onboarding (CNH photo → provider → webhook).
    // That flow lives at /(auth)/biometric — stub for now.
    router.replace('/(session)/pre-journey');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.title}>Prontidão Motorista</Text>
        <Text style={styles.subtitle}>
          Entre com o telefone cadastrado pela sua empresa.
        </Text>

        {step === 'phone' ? (
          <>
            <TextInput
              style={inputStyle}
              placeholder="+55 11 99999-0000"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
            />
            <TouchableOpacity
              style={[styles.button, { opacity: loading || phone.length < 10 ? 0.5 : 1 }]}
              disabled={loading || phone.length < 10}
              onPress={sendOtp}
            >
              <Text style={styles.buttonText}>Receber código SMS</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={inputStyle}
              placeholder="Código de 6 dígitos"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            <TouchableOpacity
              style={[styles.button, { opacity: loading || code.length !== 6 ? 0.5 : 1 }]}
              disabled={loading || code.length !== 6}
              onPress={verifyOtp}
            >
              <Text style={styles.buttonText}>Confirmar e continuar</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const inputStyle = {
  width: '100%' as const,
  backgroundColor: colors.surface,
  color: colors.text,
  padding: 14,
  borderRadius: 12,
  fontSize: 16,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: colors.border,
};
