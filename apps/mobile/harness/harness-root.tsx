import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { fixtureConfig } from "../src/test-fixtures.js";
import { App } from "../src/ui/app.js";
import { useFocusRing } from "../src/ui/components.js";
import { colors, spacing, touchTarget, typography } from "../src/ui/theme.js";
import {
  HARNESS_DRAFT_OUTCOMES,
  HARNESS_SCENARIOS,
  createHarnessAuth,
  createHarnessDeviceIdentity,
  createHarnessLifecycle,
  createHarnessOrderDelivery,
  harnessControl,
  harnessOrderSummary,
  harnessRandomUuid,
  installHarnessFetch,
  resetHarnessOrders,
  type HarnessDraftOutcome,
  type HarnessScenario,
} from "./harness-server.js";

installHarnessFetch(fixtureConfig.apiBaseUrl);

/**
 * Harness entry point. Metro resolves `src/ui/root.js` to this module only when
 * `MOBILE_VISUAL_HARNESS=1`, so the shipped app never contains it.
 */
export function Root(): React.JSX.Element {
  const [ticks, setTicks] = useState(0);
  const doubles = useMemo(() => ({
    auth: createHarnessAuth(),
    lifecycle: createHarnessLifecycle(),
    // The double redraws the control bar whenever it is offered a plan, so what
    // the screen handed over is visible without touching anything else.
    orders: createHarnessOrderDelivery(() => { setTicks((value) => value + 1); }),
  }), []);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [scenario, setScenario] = useState<HarnessScenario>("ok");
  const [draftOutcome, setDraftOutcome] = useState<HarnessDraftOutcome>("synthetic");
  const [deviceStore, setDeviceStore] = useState(harnessControl.deviceStore);
  /**
   * The keystore double is rebuilt whenever the simulated keystore changes.
   * An identity, once read, is cached for the life of the app — which is right,
   * and is why changing what the keystore holds has to look like a new
   * installation rather than a new read on the old one.
   */
  const deviceIdentity = useMemo(() => createHarnessDeviceIdentity(), [deviceStore]);
  const [orderConflict, setOrderConflict] = useState(false);
  const [reloads, setReloads] = useState(0);

  const apply = (next: HarnessScenario): void => {
    harnessControl.scenario = next;
    setScenario(next);
    setTicks((value) => value + 1);
  };

  return <SafeAreaProvider>
    <StatusBar style="dark" />
    <SafeAreaView style={styles.safeArea}>
      {/*
        The control bar used to be an unbounded ScrollView, so at 390×844 it ate
        the whole column and left the application with no usable height at all.
        Verifying the app then meant editing DOM or CSS from the browser, which
        makes a visual matrix unreproducible. The bar is now collapsible from
        inside the harness, and bounded while expanded.
      */}
      <View style={styles.controlsHeader}>
        <Text style={styles.banner}>ARNÉS DE VERIFICACIÓN · DATOS SINTÉTICOS · SIN SERVIDOR REAL</Text>
        <Toggle
          expanded={controlsExpanded}
          onPress={() => { setControlsExpanded((value) => !value); }}
        />
      </View>
      {controlsExpanded ? <ScrollView contentContainerStyle={styles.controls} horizontal={false} style={styles.controlsScroll}>
        <View style={styles.row}>
          {HARNESS_DRAFT_OUTCOMES.map((option) => <Control
            key={option.value}
            label={option.label}
            onPress={() => {
              harnessControl.draftOutcome = option.value;
              setDraftOutcome(option.value);
              setTicks((value) => value + 1);
            }}
            selected={draftOutcome === option.value}
          />)}
          <Control
            label="Limpiar intentos ofrecidos"
            onPress={() => { doubles.orders.reset(); setTicks((value) => value + 1); }}
            selected={false}
          />
        </View>
        <Text style={styles.hint}>
          {`Plan ofrecido a la integración: ${
            doubles.orders.offered().length === 0 ? "ninguno todavía" : doubles.orders.offered().join(" | ")}`}
        </Text>
        <Text style={styles.hint}>
          {`Órdenes en el servidor sintético: ${
            harnessOrderSummary().length === 0 ? "ninguna todavía" : harnessOrderSummary().join(" | ")}`}
        </Text>
        <View style={styles.row}>
          {([
            { label: "Almacén seguro: disponible", value: "available" },
            { label: "Almacén seguro: no disponible", value: "unavailable" },
            { label: "Almacén seguro: dato corrupto", value: "corrupt" },
          ] as const).map((option) => <Control
            key={option.value}
            label={option.label}
            onPress={() => {
              harnessControl.deviceStore = option.value;
              setDeviceStore(option.value);
              // The identity is read once per mount, so the app is remounted.
              setReloads((value) => value + 1);
            }}
            selected={deviceStore === option.value}
          />)}
          <Control
            label="Conflicto en la siguiente mutación"
            onPress={() => {
              harnessControl.orderConflict = !harnessControl.orderConflict;
              setOrderConflict(harnessControl.orderConflict);
              setTicks((value) => value + 1);
            }}
            selected={orderConflict}
          />
          <Control
            label="Limpiar órdenes sintéticas"
            onPress={() => { resetHarnessOrders(); setTicks((value) => value + 1); }}
            selected={false}
          />
        </View>
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
            onPress={() => {
              apply("ok");
              harnessControl.draftOutcome = "synthetic";
              setDraftOutcome("synthetic");
              harnessControl.deviceStore = "available";
              setDeviceStore("available");
              harnessControl.orderConflict = false;
              setOrderConflict(false);
              doubles.orders.reset();
              resetHarnessOrders();
              setReloads((value) => value + 1);
            }}
            selected={false}
          />
        </View>
        <Text style={styles.hint}>
          {`Contraseña "rechazar" = credenciales inválidas · correo que empieza por "b" = operador B · `
            + `operador actual: ${doubles.auth.operator()} · sesiones históricas: ${doubles.auth.history().length} · `
            + `ticker de sesión: ${harnessControl.autoRefreshRuns} · eventos: ${ticks}`}
        </Text>
      </ScrollView> : null}
      <View style={styles.app}>
        <App
          auth={doubles.auth}
          config={fixtureConfig}
          deviceIdentity={deviceIdentity}
          key={reloads}
          lifecycle={doubles.lifecycle}
          // `synthetic` means "run the real sequence", so the screen builds its
          // own productive port instead of receiving the double.
          {...(draftOutcome === "synthetic" ? {} : { orderDelivery: doubles.orders })}
          randomUuid={harnessRandomUuid}
        />
      </View>
    </SafeAreaView>
  </SafeAreaProvider>;
}

/**
 * Collapses and expands the control bar so the application can be exercised at
 * a real phone viewport without touching DOM or CSS from outside.
 *
 * Its accessible name says what it controls and its `expanded` state says which
 * way it will go, so a keyboard or screen-reader user gets the same affordance
 * as a pointer one. It is deliberately `touchTarget.primary` tall: the other
 * harness controls sit at the 44 px minimum, and this one is operated during
 * every run of the visual matrix.
 */
function Toggle({ expanded, onPress }: {
  readonly expanded: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityHint={expanded
      ? "Oculta los controles del arnés y devuelve la altura a la aplicación"
      : "Vuelve a mostrar los controles del arnés"}
    accessibilityLabel="Controles del arnés"
    accessibilityRole="button"
    accessibilityState={{ expanded }}
    // `accessibilityState.expanded` is honoured on native but react-native-web
    // 0.21 does not translate it, so the web run would expose a button with no
    // state at all. The ARIA prop is passed explicitly and maps on both.
    aria-expanded={expanded}
    onPress={onPress}
    {...focus.handlers}
    style={(state) => [
      styles.toggle,
      (state.pressed || focus.focused) && styles.controlPressed,
    ]}
  >
    <Text style={styles.controlLabel}>{expanded ? "Ocultar controles ▲" : "Mostrar controles ▼"}</Text>
  </Pressable>;
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
    gap: spacing.xs,
    padding: spacing.sm,
  },
  controlsHeader: {
    alignItems: "center",
    backgroundColor: colors.infoSurface,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // Bounded even while expanded, so the application always keeps a usable
  // column. `flexShrink` lets it give way further on short viewports.
  controlsScroll: {
    backgroundColor: colors.infoSurface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: 240,
  },
  hint: { color: colors.textMuted, ...typography.caption },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  toggle: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.primary,
    paddingHorizontal: spacing.md,
  },
});
