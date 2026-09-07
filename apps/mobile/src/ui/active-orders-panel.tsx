import { StyleSheet, View } from "react-native";
import type { ActiveTableOrderListV2, ActiveTableOrderSummaryV2 } from "@super-restaurant/shared-types";

import { renderMinorAmount } from "../money.js";
import { failureMessage, type MobileResource } from "../mobile-state.js";
import { Banner, Body, Caption, LoadingBlock, StateBlock, Subheading } from "./components.js";
import { colors, radius, spacing } from "./theme.js";

const ITEM_STATUS_LABELS: Readonly<Record<ActiveTableOrderSummaryV2["items"][number]["status"], string>> =
  Object.freeze({
    cancelled: "cancelado",
    delivered: "entregado",
    pending: "pendiente",
    preparing: "en preparación",
    ready: "listo",
    sent: "enviado",
  });

const ORDER_STATUS_LABELS: Readonly<Record<ActiveTableOrderSummaryV2["status"], string>> = Object.freeze({
  draft: "borrador en el servidor",
  open: "abierta",
  partially_paid: "parcialmente pagada",
});

/**
 * What the server says this table already carries.
 *
 * It is a *list*: a table can legitimately hold more than one active Order, so
 * nothing here assumes the composer owns the table. Every amount shown is the
 * snapshot the server stored, printed as it arrived — no subtotal, no tax, no
 * discount and no total is computed on the device, and none is shown, because
 * this app is not the authority on any of them.
 */
export function ActiveOrdersPanel({ activeOrders, onRetry }: {
  readonly activeOrders: MobileResource<ActiveTableOrderListV2>;
  readonly onRetry: () => void;
}): React.JSX.Element | null {
  if (activeOrders.status === "idle" || activeOrders.status === "loading") {
    return <LoadingBlock label="Consultando las órdenes activas de la mesa…" />;
  }

  if (activeOrders.status === "failed") {
    return <StateBlock
      action={{ label: "Reintentar", onPress: onRetry }}
      description={failureMessage(activeOrders.failure ?? "unavailable")}
      title="No se pudieron cargar las órdenes activas"
    />;
  }

  const orders = activeOrders.value?.orders ?? [];
  if (orders.length === 0) {
    return <Banner message="Esta mesa no tiene órdenes activas registradas en el servidor." tone="info" />;
  }

  return <View accessibilityLabel="Órdenes activas de la mesa" style={styles.list}>
    <Caption>
      {orders.length === 1
        ? "Esta mesa ya tiene 1 orden activa en el servidor."
        : `Esta mesa ya tiene ${orders.length} órdenes activas en el servidor.`}
    </Caption>
    {orders.map((order) => <ActiveOrderCard key={order.orderId} order={order} />)}
  </View>;
}

function ActiveOrderCard({ order }: { readonly order: ActiveTableOrderSummaryV2 }): React.JSX.Element {
  return <View style={styles.card}>
    <Subheading>{`Orden ${order.orderId.slice(0, 8)} · ${ORDER_STATUS_LABELS[order.status]}`}</Subheading>
    <Caption>
      {/* `null` is a valid historic value: the order predates operational shifts. */}
      {order.shiftId === null
        ? `Sin turno registrado · versión ${order.version}`
        : `Turno ${order.shiftId.slice(0, 8)} · versión ${order.version}`}
    </Caption>
    {order.items.length === 0
      ? <Caption>Sin líneas registradas.</Caption>
      : order.items.map((item) => <View key={item.orderItemId} style={styles.line}>
        <Body>{`${item.quantity} × ${item.productName}`}</Body>
        <Caption>
          {`${ITEM_STATUS_LABELS[item.status]} · ${item.unit} · unitario `
            + `${renderMinorAmount(item.unitPrice.amountMinor, item.unitPrice.currency)}`}
        </Caption>
        {item.modifiers.map((modifier) => <Caption key={`${item.orderItemId}:${modifier.optionId}`}>
          {`· ${modifier.groupName ?? "Modificador"}: ${modifier.optionName} ×${modifier.quantity} `
            + `(${renderMinorAmount(modifier.unitPrice.amountMinor, modifier.unitPrice.currency)})`}
        </Caption>)}
      </View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  line: { gap: 2, paddingTop: spacing.xs },
  list: { gap: spacing.sm },
});
