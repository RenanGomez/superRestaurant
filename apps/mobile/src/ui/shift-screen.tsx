import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { OperationalShiftSummaryV1 } from "@super-restaurant/shared-types";

import { failureMessage, type MobileResource } from "../mobile-state.js";
import { ActionButton, Body, Caption, Heading, LoadingBlock, StateBlock, Subheading, useFocusRing } from "./components.js";
import { colors, radius, spacing, touchTarget, typography } from "./theme.js";

export function ShiftScreen({ branchName, onBack, onRetry, onSelect, shifts }: {
  readonly branchName: string;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly onSelect: (shift: OperationalShiftSummaryV1) => void;
  readonly shifts: MobileResource<import("@super-restaurant/shared-types").OperationalShiftListV1>;
}): React.JSX.Element {
  const list = shifts.value?.shifts ?? [];
  return <ScrollView contentContainerStyle={styles.screenContent} style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Caption>{branchName}</Caption>
        <Heading>Elige el turno operativo</Heading>
        <Body>El turno agrupa el servicio de la sucursal; no es tu horario laboral ni una caja.</Body>
      </View>
      <ActionButton label="Cambiar sucursal" onPress={onBack} tone="secondary" />
    </View>
    {shifts.status === "idle" || shifts.status === "loading"
      ? <LoadingBlock label="Consultando turnos abiertos…" />
      : null}
    {shifts.status === "failed"
      ? <StateBlock
        action={{ label: "Reintentar", onPress: onRetry }}
        description={failureMessage(shifts.failure ?? "unavailable")}
        title="No se pudieron cargar los turnos"
      />
      : null}
    {shifts.status === "ready" && list.length === 0
      ? <StateBlock
        action={{ label: "Actualizar", onPress: onRetry }}
        description="No hay un turno operativo abierto para esta sucursal. Un responsable debe abrirlo antes de operar."
        title="Sin turno abierto"
      />
      : null}
    {shifts.status === "ready" && list.length > 0
      ? <View accessibilityLabel="Turnos operativos abiertos" style={styles.list}>
        {list.map((shift) => <ShiftRow key={shift.shiftId} onSelect={onSelect} shift={shift} />)}
      </View>
      : null}
  </ScrollView>;
}

function ShiftRow({ onSelect, shift }: {
  readonly onSelect: (shift: OperationalShiftSummaryV1) => void;
  readonly shift: OperationalShiftSummaryV1;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityHint="Abre las mesas y el menú dentro de este turno operativo"
    accessibilityLabel={shift.name}
    accessibilityRole="button"
    onPress={() => { onSelect(shift); }}
    {...focus.handlers}
    style={(state) => [styles.row, (state.pressed || focus.focused) && styles.rowPressed]}
  >
    <View style={styles.rowText}>
      <Subheading>{shift.name}</Subheading>
      <Caption>Abierto {new Date(shift.openedAt).toLocaleString("es-MX", { timeZone: "America/Hermosillo" })}</Caption>
    </View>
    <Text style={styles.rowStatus}>Entrar</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  header: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: {
    alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card,
    borderWidth: 1, flexDirection: "row", gap: spacing.md, justifyContent: "space-between",
    minHeight: touchTarget.primary, padding: spacing.md,
  },
  rowPressed: { borderColor: colors.focus, borderWidth: 3 },
  rowStatus: { color: colors.accent, fontWeight: "600", ...typography.body },
  rowText: { flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  screen: { flex: 1 },
  screenContent: { gap: spacing.md, padding: spacing.lg },
});
