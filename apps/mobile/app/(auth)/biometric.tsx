import { useEffect, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { getBiometricProvider } from '@/lib/biometric-provider';
import { colors, styles } from '@/lib/theme';

// Onboarding biometric screen: the driver takes a photo of their CNH.
// The image is sent (base64) to the biometric-liveness edge function, which
// forwards it to the configured provider (Unico / Idwall / Serpro) for
// face-match against the national CNH database. The provider calls back
// asynchronously via the unico-webhook edge function to update drivers.status.
// See docs/antifraud-controls.md §1 for thresholds and fallback rules.
export default function Biometric() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<'instructions' | 'camera' | 'uploading' | 'submitted'>('instructions');
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => {
    if (step === 'camera' && !permission?.granted) requestPermission();
  }, [step, permission, requestPermission]);

  async function captureAndSubmit() {
    if (!cameraRef.current) return;
    setStep('uploading');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.8,
        skipProcessing: true,
      });

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error('Sessão expirada. Faça login novamente.');

      // Resolve the driver record for the authenticated user.
      const { data: driver, error: dErr } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', userId)
        .single();
      if (dErr || !driver) throw new Error('Motorista não encontrado. Contate o gestor.');

      const provider = getBiometricProvider();
      await provider.enrollCnh(driver.id, photo.base64 ?? '');

      setStep('submitted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      Alert.alert('Erro no envio', msg, [
        { text: 'Tentar novamente', onPress: () => setStep('camera') },
      ]);
    }
  }

  // --- Instructions step ---
  if (step === 'instructions') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={[styles.center, { paddingHorizontal: 8 }]}>
          <Text style={styles.title}>Verificação de identidade</Text>
          <Text style={styles.subtitle}>
            Para liberar seu acesso, precisamos comparar sua face com a foto da sua CNH no
            sistema do Detran. Prepare sua CNH e certifique-se de estar em um local bem
            iluminado.
          </Text>
          <View style={[styles.card, { width: '100%', marginBottom: 24 }]}>
            <Tip text="Segure a CNH na altura do rosto, frente para a câmera." />
            <Tip text="Boa iluminação — evite sombras no rosto ou no documento." />
            <Tip text="Foto nítida, sem reflexos ou dedos cobrindo dados." />
          </View>
          <TouchableOpacity style={styles.button} onPress={() => setStep('camera')}>
            <Text style={styles.buttonText}>Abrir câmera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- Submitted step ---
  if (step === 'submitted') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Enviado!</Text>
          <Text style={styles.subtitle}>
            Sua foto foi enviada para verificação. Você receberá uma notificação quando a análise
            for concluída. Em geral leva menos de 1 minuto.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(session)/pre-journey')}
          >
            <Text style={styles.buttonText}>Continuar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- No permission ---
  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Acesso à câmera</Text>
          <Text style={styles.subtitle}>
            Precisamos da câmera para fotografar sua CNH.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => requestPermission()}>
            <Text style={styles.buttonText}>Permitir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const uploading = step === 'uploading';

  // --- Camera / uploading step ---
  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ flex: 1, paddingVertical: 20 }}>
        <Text style={styles.title}>Foto da CNH</Text>
        <Text style={styles.subtitle}>
          Enquadre sua CNH no centro da tela e toque em Capturar.
        </Text>
        <View
          style={{
            flex: 1,
            borderRadius: 16,
            overflow: 'hidden',
            borderWidth: 2,
            borderColor: colors.border,
            marginBottom: 24,
          }}
        >
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        </View>
        <TouchableOpacity
          style={[styles.button, { opacity: uploading ? 0.5 : 1 }]}
          disabled={uploading}
          onPress={captureAndSubmit}
        >
          <Text style={styles.buttonText}>{uploading ? 'Enviando…' : 'Capturar'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' }}>
      <Text style={{ color: colors.primary, fontWeight: '700', marginRight: 8 }}>•</Text>
      <Text style={{ color: colors.textMuted, fontSize: 14, flex: 1 }}>{text}</Text>
    </View>
  );
}
