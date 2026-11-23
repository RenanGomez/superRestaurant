import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  formatSyncClock,
  syncAttentionCount,
  syncConnectivityLabel,
  syncItemDetail,
  syncItemTitle,
  syncPendingCount,
  visibleSyncQueue,
  type MobileSyncSnapshot,
} from "../mobile-state.js";

import { ActionButton, Banner, Body, Caption, Card, StateBlock, Subheading } from "./components.js";
import { colors, spacing, typography } from "./theme.js";

/**
 * Pending-sync queue of the active branch.
 *
 * It lists every local change that has not been confirmed yet, together with
 * what the operator can do about it. Nothing here says a payment was charged:
 * a queued cash collection is evidence waiting for the server, and a rejected
 * one is a problem a supervisor has to review.
 */
export function PendingSyncScreen({
  onClose,
  onRetryAll,
  retrying,
  snapshot,
}: {
  readonly onClose: () => void;
  readonly onRetryAll: () => void;
  readonly retrying: boolean;
  readonly snapshot: MobileSyncSnapshot;
}): React.JSX.Element {
  const items = visibleSyncQueue(snapshot);
  const pending = syncPendingCount(snapshot);
  const attention = syncAttentionCount(snapshot);
  const clock = formatSyncClock(snapshot.lastConfirmedSyncAt);

  return <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Subheading>Sincronización</Subheading>
        <Caption>{`${syncConnectivityLabel(snapshot.connectivity)} · ${pending === 0 ? "sin pendientes" : `pendientes: ${pending}`}`}</Caption>
        <Caption>{clock === null ? "Última sincronización: sin confirmar" : `Última sincronización: ${clock}`}</Caption>
      </View>
      <ActionButton label="Volver" onPress={onClose} tone="secondary" />
    </View>

    {snapshot.storageAvailable
      ? null
      : <Banner
        message="Este dispositivo no tiene almacenamiento local disponible. Los cambios no se pueden guardar para enviarlos después; reconecta para operar con el servidor."
        tone="error"
      />}

    {attention > 0
      ? <Banner
        message="Hay cambios que el servidor rechazó o que necesitan revisión de un supervisor. Reintentar no los corrige por sí solo."
        tone="error"
      />
      : null}

    {items.length === 0
      ? <StateBlock
        description="No hay cambios esperando llegar al servidor. Lo que ya se confirmó no aparece en esta lista."
        title="Sin pendientes"
      />
      : <View style={styles.list}>
        {items.map((item) => <Card key={item.eventId}>
          <View style={styles.itemHeader}>
            <Subheading>{syncItemTitle(item)}</Subheading>
            {item.financial ? <Text style={styles.financial}>Dinero</Text> : null}
          </View>
          <Body>{syncItemDetail(item)}</Body>
          <Caption>{`Registrado: ${formatSyncClock(item.occurredAt) ?? "hora no disponible"}`}</Caption>
        </Card>)}
      </View>}

    {items.length === 0
      ? null
      : <View style={styles.footer}>
        <ActionButton
          busy={retrying}
          disabled={retrying || pending === 0}
          label="Reintentar pendientes"
          onPress={onRetryAll}
        />
      </View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  financial: { color: colors.info, fontWeight: "700", ...typography.caption },
  footer: { marginTop: spacing.lg },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  itemHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  list: { gap: spacing.sm },
  screen: { flexGrow: 1, padding: spacing.lg },
});
