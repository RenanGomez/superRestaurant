import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { BranchMembershipSummaryV1 } from "@super-restaurant/shared-types";

import type { MobileBranchScope } from "../mobile-client.js";
import { failureMessage, type MobileFailure, type MobileResource } from "../mobile-state.js";
import {
  ActionButton,
  Banner,
  Body,
  Caption,
  Heading,
  LoadingBlock,
  StateBlock,
  Subheading,
  useFocusRing,
} from "./components.js";
import { colors, radius, spacing, touchTarget, typography } from "./theme.js";

export function BranchScreen({ branchFailure, memberships, notice, onRetry, onSelect, onSignOut, pendingScope }: {
  readonly branchFailure: MobileFailure | undefined;
  readonly memberships: MobileResource<readonly BranchMembershipSummaryV1[]>;
  readonly notice: string | undefined;
  readonly onRetry: () => void;
  readonly onSelect: (scope: MobileBranchScope) => void;
  readonly onSignOut: () => void;
  readonly pendingScope: MobileBranchScope | undefined;
}): React.JSX.Element {
  const list = memberships.value ?? [];

  return <View style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Caption>superRestaurant</Caption>
        <Heading>Elige tu sucursal</Heading>
      </View>
      <ActionButton label="Salir" onPress={onSignOut} tone="secondary" />
    </View>

    {notice === undefined ? null : <Banner message={notice} tone="info" />}
    {branchFailure === undefined || branchFailure === "authorization"
      ? null
      : <Banner message={failureMessage(branchFailure)} tone="error" />}

    {memberships.status === "loading" || memberships.status === "idle"
      ? <LoadingBlock label="Consultando tus sucursales…" />
      : null}

    {memberships.status === "failed"
      ? <StateBlock
        action={{ label: "Reintentar", onPress: onRetry }}
        description={failureMessage(memberships.failure ?? "unavailable")}
        title="No se pudieron cargar tus sucursales"
      />
      : null}

    {memberships.status === "ready" && list.length === 0
      ? <StateBlock
        action={{ label: "Actualizar", onPress: onRetry }}
        description="Tu cuenta no tiene sucursales asignadas o su acceso fue revocado. Solicita autorización a un supervisor."
        title="Sin sucursales asignadas"
      />
      : null}

    {memberships.status === "ready" && list.length > 0
      ? <FlatList
        accessibilityLabel="Sucursales autorizadas"
        contentContainerStyle={styles.list}
        data={list}
        keyExtractor={(item) => `${item.scope.restaurantId}:${item.scope.branchId}`}
        renderItem={({ item }) => <MembershipRow
          busy={pendingScope !== undefined}
          membership={item}
          onSelect={onSelect}
          pending={pendingScope !== undefined
            && pendingScope.restaurantId === item.scope.restaurantId
            && pendingScope.branchId === item.scope.branchId}
        />}
      />
      : null}
  </View>;
}

function MembershipRow({ busy, membership, onSelect, pending }: {
  readonly busy: boolean;
  readonly membership: BranchMembershipSummaryV1;
  readonly onSelect: (scope: MobileBranchScope) => void;
  readonly pending: boolean;
}): React.JSX.Element {
  const focus = useFocusRing();
  return <Pressable
    accessibilityHint="Revalida tu acceso con el servidor antes de abrir la sucursal"
    accessibilityLabel={`${membership.restaurantName}, ${membership.branchName}`}
    accessibilityRole="button"
    accessibilityState={{ busy: pending, disabled: busy }}
    disabled={busy}
    onPress={() => { onSelect({ branchId: membership.scope.branchId, restaurantId: membership.scope.restaurantId }); }}
    {...focus.handlers}
    style={(state) => [
      styles.row,
      (state.pressed || focus.focused) && styles.rowPressed,
      busy && !pending && styles.rowInactive,
    ]}
  >
    <View style={styles.rowText}>
      <Subheading>{membership.restaurantName}</Subheading>
      <Body>{membership.branchName}</Body>
      <Caption>{membership.roles.join(" · ")}</Caption>
    </View>
    <Text style={styles.rowStatus}>{pending ? "Validando…" : "Abrir"}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: touchTarget.primary,
    padding: spacing.md,
  },
  rowInactive: { opacity: 0.6 },
  rowPressed: { borderColor: colors.focus, borderWidth: 3 },
  rowStatus: { color: colors.accent, fontWeight: "600", ...typography.body },
  rowText: { flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  screen: { flex: 1, gap: spacing.sm, padding: spacing.lg },
});
