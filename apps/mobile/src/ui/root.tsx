import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import type { MobileAuthPort } from "../auth-port.js";
import { readMobileConfig, type MobileConfig } from "../config.js";
import { createMobileAuth } from "../supabase-auth.js";
import { App } from "./app.js";
import { Body, Caption, Heading } from "./components.js";
import { colors, spacing } from "./theme.js";

/**
 * Expo only inlines `process.env.EXPO_PUBLIC_*` when each variable is read by
 * name, so the three public variables are listed explicitly here.
 */
function readEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  };
}

/** Root component: fails closed when the public configuration is unusable. */
export function Root(): React.JSX.Element {
  const bootstrap = useMemo((): { readonly auth: MobileAuthPort; readonly config: MobileConfig } | undefined => {
    try {
      const config = readMobileConfig(readEnvironment());
      return { auth: createMobileAuth(config), config };
    } catch {
      return undefined;
    }
  }, []);

  return <SafeAreaProvider>
    <StatusBar style="dark" />
    <SafeAreaView style={styles.safeArea}>
      {bootstrap === undefined
        ? <ConfigurationErrorScreen />
        : <App auth={bootstrap.auth} config={bootstrap.config} />}
    </SafeAreaView>
  </SafeAreaProvider>;
}

function ConfigurationErrorScreen(): React.JSX.Element {
  return <ScrollView contentContainerStyle={styles.errorContent}>
    <View style={styles.errorCard}>
      <Caption>superRestaurant</Caption>
      <Heading>Configuración no válida</Heading>
      <Body>
        La aplicación no puede iniciar porque su configuración pública es incorrecta o falta. No se realizará ninguna
        llamada al servidor.
      </Body>
      <Caption>
        Se requieren EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY y EXPO_PUBLIC_API_BASE_URL. La clave
        debe ser publishable; nunca una clave secreta o de servicio.
      </Caption>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  errorCard: { gap: spacing.sm, maxWidth: 520, width: "100%" },
  errorContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  safeArea: { backgroundColor: colors.background, flex: 1 },
});
