import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { fixtureConfig } from "../src/test-fixtures.js";
import { App } from "../src/ui/app.js";
import { useFocusRing } from "../src/ui/components.js";
import { colors, spacing, touchTarget, typography } from "../src/ui/theme.js";
import {
  HARNESS_SCENARIOS,
  createHarnessAuth,
  createHarnessLifecycle,
  harnessControl,
  installHarnessFetch,
  type HarnessScenario,
} from "./harness-server.js";

installHarnessFetch(fixtureConfig.apiBaseUrl);

/**
 * Harness entry point. Metro resolves `src/ui/root.js` to this module only when
 * `MOBILE_VISUAL_HARNESS=1`, so the shipped app never contains it.
 */
export function Root(): React.JSX.Element {
  const doubles = useMemo(() => ({ auth: createHarnessAuth(), lifecycle: createHarnessLifecycle() }), []);
  const [scenario, setScenario] = useState<HarnessScenario>("ok");
  const [reloads, setReloads] = useState(0);
  const [ticks, setTicks] = useState(0);

  const apply = (next: HarnessScenario): void => {
    harnessControl.scenario = next;
    setScenario(next);
    setTicks((value) => value + 1);
  };

  return <SafeAreaProvider>
    <StatusBar style="dark" />
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.controls} horizontal={false}>
        <Text style={styles.banner}>ARNÉS DE VERIFICACIÓN · DATOS SINTÉTICOS · SIN SERVIDOR REAL</Text>
        <View style={styles.row}>
          {HARNESS_SCENARIOS.map((option) => <Control
            key={option.value}
            label={option.label}
            onPress={() => { apply(option.value); }}
            selected={scenario === option.value}
          />)}
        </View>
        <View style={styles.row}>
          <Control
            label="Ir a segundo plano"
            onPress={() => { doubles.lifecycle.emit("background"); setTicks((value) => value + 1); }}
            selected={false}
          />
          <Control
            label="Volver a primer plano"
            onPress={() => { doubles.lifecycle.emit("active"); setTicks((value) => value + 1); }}
            selected={false}
          />
          <Control
            label="Renovar token"
            onPress={() => { doubles.auth.emitRefreshedToken(); setTicks((value) => value + 1); }}
            selected={false}
          />
          <Control
            label="Notificar sesión histórica 1"
            onPress={() => { doubles.auth.emitHistoricalSession(0); setTicks((value) => value + 1); }}
            selected={false}
          />
          <Control
            label="Notificar sesión histórica 2"
            onPress={() => { doubles.auth.emitHistoricalSession(1); setTicks((value) => value + 1); }}
            selected={false}
          />
          <Control
            label="Notificar todas las históricas"
            onPress={() => {
              const total = doubles.auth.history().length;
              for (let index = 0; index < total; index += 1) doubles.auth.emitHistoricalSession(index);
              setTicks((value) => value + 1);
            }}
            selected={false}
          />
          <Control
            label="Reiniciar app"
            onPress={() => { setReloads((value) => value + 1); setTicks((value) => value + 1); }}
            selected={false}
          />
          <Control
            label="Reiniciar arnés"
            onPress={() => { apply("ok"); setReloads((value) => value + 1); }}
            selected={false}
          />
        </View>
        <Text style={styles.hint}>
          {`Contraseña "rechazar" = credenciales inválidas · correo que empieza por "b" = operador B · `
            + `operador actual: ${doubles.auth.operator()} · sesiones históricas: ${doubles.auth.history().length} · `
            + `ticker de sesión: ${harnessControl.autoRefreshRuns} · eventos: ${ticks}`}
        </Text>
      </ScrollView>
      <View style={styles.app}>
        <App auth={doubles.auth} config={fixtureConfig} key={reloads} lifecycle={doubles.lifecycle} />
      </View>
    </SafeAreaView>
  </SafeAreaProvider>;
}

function Control({ label, onPress, selected }: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [
      styles.control,
      selected && styles.controlSelected,
      (state.pressed || focus.focused) && styles.controlPressed,
    ]}
  >
    <Text style={[styles.controlLabel, selected && styles.controlLabelSelected]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  banner: { color: colors.danger, fontWeight: "700", ...typography.caption },
  control: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.minimum,
    paddingHorizontal: spacing.sm,
  },
  controlLabel: { color: colors.text, ...typography.caption },
  controlLabelSelected: { color: colors.accentText },
  controlPressed: { borderColor: colors.focus, borderWidth: 3 },
  controlSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  controls: {
    backgroundColor: colors.infoSurface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  hint: { color: colors.textMuted, ...typography.caption },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  safeArea: { backgroundColor: colors.background, flex: 1 },
});
