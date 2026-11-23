import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  REALTIME_NAMESPACE,
  decodeKitchenReadyWireFrame,
  encodeKitchenReadySubscribeFrame,
  encodeRealtimeConnectFrame,
  kitchenReadyMatchesSubscription,
  parseKitchenReadySubscriptionV1,
  realtimeWebSocketUrl,
  type ActiveTableOrderListV2,
  type ActiveTableOrderSummaryV2,
  type KitchenReadyNotificationV1,
} from "@super-restaurant/shared-types";

import { renderMinorAmount } from "../money.js";
import { failureMessage, type MobileResource } from "../mobile-state.js";
import { ActionButton, Banner, Body, Caption, LoadingBlock, StateBlock, Subheading } from "./components.js";
import { colors, radius, spacing } from "./theme.js";

export interface ActiveOrdersRealtimeConfig {
  readonly accessToken: string;
  readonly apiBaseUrl: string;
  readonly stationId?: string | null;
}

const MAX_READY_ALERTS = 5;

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
export function ActiveOrdersPanel({ activeOrders, collectingOrderId, onCollectOrder, onRetry, realtime }: {
  readonly activeOrders: MobileResource<ActiveTableOrderListV2>;
  readonly collectingOrderId?: string | undefined;
  readonly onCollectOrder?: ((orderId: string) => void) | undefined;
  readonly onRetry: () => void;
  readonly realtime?: ActiveOrdersRealtimeConfig | undefined;
}): React.JSX.Element | null {
  const [readyAlerts, setReadyAlerts] = useState<readonly KitchenReadyNotificationV1[]>([]);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const scope = activeOrders.value?.scope;

  useEffect(() => {
    setReadyAlerts([]);
    if (realtime === undefined || scope === undefined || typeof WebSocket === "undefined") return undefined;
    const subscription = parseKitchenReadySubscriptionV1({
      schemaVersion: 1,
      scope,
      stationId: realtime.stationId ?? null,
    });
    if (subscription === undefined) return undefined;

    let active = true;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const wsUrl = realtimeWebSocketUrl(realtime.apiBaseUrl);

    const connect = (): void => {
      if (!active) return;
      try { socket = new WebSocket(wsUrl); } catch { return; }
      const current = socket;
      current.onmessage = (message): void => {
        if (!active || typeof message.data !== "string") return;
        const decoded = decodeKitchenReadyWireFrame(message.data);
        if (decoded.kind === "ping") current.send("3");
        else if (decoded.kind === "open") current.send(encodeRealtimeConnectFrame(realtime.accessToken));
        else if (decoded.kind === "connected") current.send(encodeKitchenReadySubscribeFrame(subscription));
        else if (decoded.kind === "closed") current.close();
        else if (decoded.kind === "ack") {
          if (
            decoded.ack === undefined
            || decoded.ack.scope.restaurantId !== scope.restaurantId
            || decoded.ack.scope.branchId !== scope.branchId
            || decoded.ack.stationId !== subscription.stationId
          ) current.close();
        } else if (decoded.kind === "ready" && decoded.notification !== undefined && kitchenReadyMatchesSubscription(subscription, decoded.notification)) {
          const ready = decoded.notification;
          setReadyAlerts((existing) => existing.some((item) => item.eventId === ready.eventId)
            ? existing
            : [ready, ...existing].slice(0, MAX_READY_ALERTS));
          onRetryRef.current();
        }
      };
      current.onerror = (): void => { current.close(); };
      current.onclose = (): void => { if (active) reconnectTimer = setTimeout(connect, 3_000); };
    };

    connect();
    return (): void => {
      active = false;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      try {
        if (socket?.readyState === WebSocket.OPEN) socket.send(`41${REALTIME_NAMESPACE},`);
        socket?.close();
      } catch { /* Ignore cleanup failure on closed socket. */ }
    };
  }, [realtime?.accessToken, realtime?.apiBaseUrl, realtime?.stationId, scope?.branchId, scope?.restaurantId]);

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
  const alertsBlock = readyAlerts.length === 0 ? null : <View style={styles.alerts}>
    {readyAlerts.map((alert) => {
      const matchedOrder = orders.find((order) => order.orderId === alert.orderId);
      const matchedItem = matchedOrder?.items.find((item) => item.orderItemId === alert.orderItemId);
      const detail = matchedItem === undefined
        ? `Platillo listo en ${alert.stationId} · Orden ${alert.orderId.slice(0, 8)}`
        : `Platillo listo: ${matchedItem.quantity} × ${matchedItem.productName} (${alert.stationId})`;
      return <View key={alert.eventId} style={styles.alertRow}>
        <Banner message={detail} tone="success" />
        <ActionButton
          label="Descartar aviso"
          onPress={() => { setReadyAlerts((current) => current.filter((item) => item.eventId !== alert.eventId)); }}
          tone="secondary"
        />
      </View>;
    })}
  </View>;

  if (orders.length === 0) {
    return <View style={styles.list}>
      {alertsBlock}
      <Banner message="Esta mesa no tiene órdenes activas registradas en el servidor." tone="info" />
    </View>;
  }

  return <View accessibilityLabel="Órdenes activas de la mesa" style={styles.list}>
    {alertsBlock}
    <Caption>
      {orders.length === 1
        ? "Esta mesa ya tiene 1 orden activa en el servidor."
        : `Esta mesa ya tiene ${orders.length} órdenes activas en el servidor.`}
    </Caption>
    {orders.map((order) => <ActiveOrderCard
      collecting={collectingOrderId === order.orderId.toLowerCase()}
      key={order.orderId}
      onCollectOrder={onCollectOrder}
      order={order}
    />)}
  </View>;
}

function ActiveOrderCard({ collecting, onCollectOrder, order }: {
  readonly collecting: boolean;
  readonly onCollectOrder?: ((orderId: string) => void) | undefined;
  readonly order: ActiveTableOrderSummaryV2;
}): React.JSX.Element {
  const payable = order.status === "open" || order.status === "partially_paid";
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
      : order.items.map((item) => <View key={item.orderItemId} style={[styles.line, item.status === "ready" && styles.readyLine]}>
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
    {payable && onCollectOrder !== undefined
      ? <View style={styles.actions}>
        <ActionButton
          disabled={collecting}
          label={collecting ? "Cobro abierto" : "Cobrar cuenta"}
          onPress={() => { onCollectOrder(order.orderId); }}
          tone={collecting ? "secondary" : "primary"}
        />
      </View>
      : null}
  </View>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.xs },
  alertRow: { gap: spacing.xs },
  alerts: { gap: spacing.sm },
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
  readyLine: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
  },
});
