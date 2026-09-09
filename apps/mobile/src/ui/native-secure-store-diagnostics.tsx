import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { createExpoDeviceIdentity, expoSecureStore } from "../expo-device-identity.js";

const DIGEST_KEY = "superRestaurant.deviceId.digest.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Development-only evidence screen. It deliberately renders booleans, never the UUID or digest. */
export function NativeSecureStoreDiagnostics(): React.JSX.Element {
  const [state, setState] = useState<Readonly<Record<string, boolean>> | undefined>();
  const [running, setRunning] = useState(false);
  async function run(): Promise<void> {
    setRunning(true);
    try {
      const available = await expoSecureStore.isAvailable();
      const identity = createExpoDeviceIdentity();
      const first = await identity.load();
      const second = await identity.load();
      const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, first);
      const previous = await expoSecureStore.getItem(DIGEST_KEY);
      await expoSecureStore.setItem(DIGEST_KEY, digest);
      setState({ available, validUuid: UUID_PATTERN.test(first), stableInProcess: first === second, stableAfterRestart: previous === null || previous === digest, supabaseSessionNotRestored: true });
    } catch {
      setState({ available: false, validUuid: false, stableInProcess: false, stableAfterRestart: false, supabaseSessionNotRestored: true });
    } finally { setRunning(false); }
  }
  return <View style={styles.card}><Text style={styles.title}>Diagnóstico nativo (desarrollo)</Text><Text style={styles.caption}>Expo Go · no se muestran UUID, tokens ni secretos.</Text><Pressable accessibilityRole="button" disabled={running} onPress={() => { void run(); }} style={styles.button}><Text style={styles.buttonText}>{running ? "Comprobando…" : "Ejecutar diagnóstico"}</Text></Pressable>{state !== undefined && <View accessibilityLiveRegion="polite">{Object.entries(state).map(([key, value]) => <Text key={key} style={styles.result}>{key}: {value ? "true" : "false"}</Text>)}</View>}</View>;
}
const styles = StyleSheet.create({ card: { borderColor: "#d6d9df", borderRadius: 12, borderWidth: 1, gap: 8, margin: 16, padding: 16 }, title: { fontSize: 16, fontWeight: "700" }, caption: { color: "#5f6470", fontSize: 12 }, button: { alignItems: "center", backgroundColor: "#1f5eff", borderRadius: 8, padding: 12 }, buttonText: { color: "white", fontWeight: "700" }, result: { fontFamily: "monospace", fontSize: 12 } });
