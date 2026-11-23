import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MobileConfig } from "../config.js";
import type { MobileSession } from "../session.js";
import type { OrderDeliveryPlanV1 } from "../order-plan.js";
import {
  describeSyncBanner,
  EMPTY_MOBILE_SYNC_SNAPSHOT,
  type MobileSyncQueueItem,
  type MobileSyncSnapshot,
} from "../mobile-state.js";
import {
  enqueueCashCollectOffline,
  enqueueOrderPlanOffline,
  type MobileOfflineQueueResult,
  type OfflineCashCollectInput,
  type OfflineCashPreconditions,
} from "../order-submission.js";
import { createMobileOfflineTransport, openMobileOfflineRuntime } from "../offline/expo-offline.js";
import { DeviceSyncEngine, type OutboxEntry } from "@super-restaurant/sync-engine";
import {
  isSyncFinancialEntityTypeV1,
  type BranchScope,
  type SyncConnectivityStateV1,
} from "@super-restaurant/shared-types";

import { ActionButton } from "./components.js";
import { colors, radius, spacing, typography } from "./theme.js";

/**
 * Persistent connectivity bar of the mobile workspace.
 *
 * It stays visible in every tab so the operator always knows the device's
 * connectivity, the active branch and whether anything still has to reach the
 * server. The queue itself lives in `PendingSyncScreen`; this bar only opens it.
 */
export function SyncBanner({
  branchName,
  onOpenQueue,
  snapshot,
}: {
  readonly branchName: string | undefined;
  readonly onOpenQueue: () => void;
  readonly snapshot: MobileSyncSnapshot;
}): React.JSX.Element {
  const model = describeSyncBanner(snapshot, branchName);
  const toneStyle = model.tone === "error"
    ? styles.bannerError
    : model.tone === "success" ? styles.bannerSuccess : styles.bannerInfo;
  const toneText = model.tone === "error"
    ? styles.textError
    : model.tone === "success" ? styles.textSuccess : styles.textInfo;
  return <View
    accessibilityLabel={model.message}
    accessibilityLiveRegion="polite"
    accessibilityRole="alert"
    style={[styles.banner, toneStyle]}
  >
    <View style={styles.bannerText}>
      <Text style={[styles.connectivity, toneText]}>{model.connectivityLabel}</Text>
      <Text style={[styles.detail, toneText]}>{model.message}</Text>
      {model.attentionLabel === undefined
        ? null
        : <Text style={[styles.attention, toneText]}>{model.attentionLabel}</Text>}
    </View>
    <View style={styles.bannerActions}>
      <ActionButton label="Ver pendientes" onPress={onOpenQueue} tone="secondary" />
    </View>
  </View>;
}

/**
 * Runtime bridge between the mobile UI and the durable sync engine.
 *
 * The engine is opened from `src/offline` (the only module that touches
 * SQLCipher). If that is unavailable on this runtime — Expo web, Expo Go or a
 * build without the SQLCipher plugin — the bar says so and every offline action
 * is refused instead of pretending the change was saved.
 */
export interface MobileSyncBridge {
  readonly snapshot: MobileSyncSnapshot;
  readonly refresh: () => void;
  readonly retryAll: () => void;
  readonly queueOrder: (plan: OrderDeliveryPlanV1) => Promise<MobileOfflineQueueResult>;
  readonly queueCash: (
    cash: OfflineCashCollectInput,
    preconditions: OfflineCashPreconditions,
  ) => Promise<MobileOfflineQueueResult>;
}

function deviceConnectivity(): SyncConnectivityStateV1 {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return "online";
}

function toQueueItem(entry: OutboxEntry): MobileSyncQueueItem {
  return Object.freeze({
    entityType: entry.entityType,
    errorCode: entry.lastErrorCode,
    eventId: entry.eventId,
    financial: isSyncFinancialEntityTypeV1(entry.entityType),
    localState: entry.localState,
    occurredAt: entry.occurredAt,
    operation: entry.operation,
    retryCount: entry.retryCount,
  });
}

export function useMobileSyncBridge(options: {
  readonly config: MobileConfig;
  readonly deviceId: string | undefined;
  readonly scope: { readonly branchId: string; readonly restaurantId: string } | undefined;
  readonly session: MobileSession | undefined;
}): MobileSyncBridge {
  const branchId = options.scope?.branchId;
  const restaurantId = options.scope?.restaurantId;
  const userId = options.session?.userId;
  const apiBaseUrl = options.config.apiBaseUrl;

  const [snapshot, setSnapshot] = useState<MobileSyncSnapshot>(EMPTY_MOBILE_SYNC_SNAPSHOT);
  const engineRef = useRef<DeviceSyncEngine | undefined>(undefined);
  const scopeRef = useRef<BranchScope | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(options.session?.accessToken);
  const actorRef = useRef<string | undefined>(userId);
  const connectivityRef = useRef<SyncConnectivityStateV1>(deviceConnectivity());
  const storageRef = useRef(false);
  const syncingRef = useRef(false);
  const lastConfirmedRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = options.session?.accessToken;
    actorRef.current = userId;
  }, [options.session?.accessToken, userId]);

  const refresh = useCallback(async (): Promise<void> => {
    const engine = engineRef.current;
    const active = scopeRef.current;
    if (engine === undefined || active === undefined) {
      setSnapshot((previous) => Object.freeze({
        ...previous,
        connectivity: connectivityRef.current,
        storageAvailable: storageRef.current,
      }));
      return;
    }
    try {
      const [entries] = await Promise.all([engine.getOutbox(active), engine.getStatusSummary(active)]);
      if (scopeRef.current !== active) return;
      setSnapshot(Object.freeze({
        connectivity: connectivityRef.current,
        items: Object.freeze(entries.map(toQueueItem)),
        lastConfirmedSyncAt: lastConfirmedRef.current,
        scope: Object.freeze({ branchId: active.branchId, restaurantId: active.restaurantId }),
        storageAvailable: true,
        syncing: syncingRef.current,
      }));
    } catch {
      storageRef.current = false;
      setSnapshot((previous) => Object.freeze({ ...previous, storageAvailable: false }));
    }
  }, []);

  const syncNow = useCallback(async (): Promise<void> => {
    const engine = engineRef.current;
    const active = scopeRef.current;
    if (engine === undefined || active === undefined) return;
    syncingRef.current = true;
    void refresh();
    try {
      const result = await engine.sync(active);
      const revoked = result.push.revoked || result.pull.status === "revoked";
      const failed = result.push.failureCode !== null || result.pull.status === "failed";
      if (revoked) {
        connectivityRef.current = "sync_blocked";
      } else if (failed) {
        connectivityRef.current = "offline";
      } else {
        connectivityRef.current = "online";
        lastConfirmedRef.current = new Date().toISOString();
      }
    } catch {
      connectivityRef.current = "offline";
    } finally {
      syncingRef.current = false;
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    scopeRef.current = branchId !== undefined && restaurantId !== undefined
      ? Object.freeze({ branchId, restaurantId } as BranchScope)
      : undefined;
    const active = scopeRef.current;
    engineRef.current = undefined;
    storageRef.current = false;
    if (active === undefined || options.deviceId === undefined || userId === undefined) {
      setSnapshot(Object.freeze({ ...EMPTY_MOBILE_SYNC_SNAPSHOT, connectivity: connectivityRef.current }));
      return;
    }

    let alive = true;
    let runtime: Awaited<ReturnType<typeof openMobileOfflineRuntime>> | undefined;
    const open = async (): Promise<void> => {
      try {
        runtime = await openMobileOfflineRuntime();
        if (!alive) {
          await runtime.close();
          return;
        }
        const engine = new DeviceSyncEngine({
          clientType: "mobile",
          connectivity: () => connectivityRef.current,
          deviceId: runtime.deviceId,
          storage: runtime.storage,
          transport: createMobileOfflineTransport(runtime, {
            accessToken: async (): Promise<string | undefined> => tokenRef.current,
            apiBaseUrl,
          }),
        });
        await engine.init();
        if (!alive) return;
        engineRef.current = engine;
        storageRef.current = true;
        await refresh();
        await syncNow();
      } catch {
        if (alive) {
          storageRef.current = false;
          setSnapshot(Object.freeze({ ...EMPTY_MOBILE_SYNC_SNAPSHOT, connectivity: connectivityRef.current }));
        }
      }
    };
    void open();

    const timer = setInterval(() => { void refresh(); }, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
      engineRef.current = undefined;
      storageRef.current = false;
      if (runtime !== undefined) void runtime.close();
    };
  }, [apiBaseUrl, branchId, options.deviceId, refresh, restaurantId, syncNow, userId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
    const update = (): void => {
      connectivityRef.current = deviceConnectivity();
      void refresh();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [refresh]);

  const queueOrder = useCallback(async (plan: OrderDeliveryPlanV1): Promise<MobileOfflineQueueResult> => {
    const engine = engineRef.current;
    const actorId = actorRef.current;
    if (engine === undefined || actorId === undefined) {
      return Object.freeze({ eventIds: [], queued: false, reasonCode: "SESSION_REQUIRED" });
    }
    const result = await enqueueOrderPlanOffline({
      actorId,
      plan,
      port: {
        canEnqueue: (input) => engine.canEnqueue(input),
        enqueue: (input) => engine.enqueue(input),
      },
    });
    if (result.queued) {
      await syncNow();
    } else {
      await refresh();
    }
    return result;
  }, [refresh, syncNow]);

  const queueCash = useCallback(async (
    cash: OfflineCashCollectInput,
    preconditions: OfflineCashPreconditions,
  ): Promise<MobileOfflineQueueResult> => {
    const engine = engineRef.current;
    const actorId = actorRef.current;
    const active = scopeRef.current;
    if (engine === undefined || actorId === undefined || active === undefined) {
      return Object.freeze({ eventIds: [], queued: false, reasonCode: "SESSION_REQUIRED" });
    }
    const result = await enqueueCashCollectOffline({
      actorId,
      cash,
      port: {
        canEnqueue: (input) => engine.canEnqueue(input),
        enqueue: (input) => engine.enqueue(input),
      },
      preconditions,
      scope: active,
    });
    if (result.queued) {
      await syncNow();
    } else {
      await refresh();
    }
    return result;
  }, [refresh, syncNow]);

  return Object.freeze({
    queueCash,
    queueOrder,
    refresh: (): void => { void refresh(); },
    retryAll: (): void => { void syncNow(); },
    snapshot,
  });
}

const styles = StyleSheet.create({
  attention: { fontWeight: "700", ...typography.caption },
  banner: {
    alignItems: "center",
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerActions: { flexShrink: 0 },
  bannerError: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  bannerInfo: { backgroundColor: colors.infoSurface, borderColor: colors.info },
  bannerSuccess: { backgroundColor: "#e9f6ee", borderColor: "#1b6e3c" },
  bannerText: { flexGrow: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  connectivity: { fontWeight: "700", ...typography.body },
  detail: { ...typography.caption },
  textError: { color: colors.danger },
  textInfo: { color: colors.info },
  textSuccess: { color: "#14532d" },
});
