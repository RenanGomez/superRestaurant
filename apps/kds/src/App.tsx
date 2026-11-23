import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { io, type Socket } from "socket.io-client";
import {
  KDS_INITIAL_CURSOR,
  REALTIME_KITCHEN_READY_EVENT,
  REALTIME_KITCHEN_READY_SUBSCRIBE_EVENT,
  REALTIME_NAMESPACE,
  REALTIME_NOTIFICATION_EVENT,
  REALTIME_SUBSCRIBE_EVENT,
  parseKitchenReadyNotificationV1,
  parseKitchenReadySubscriptionAckV1,
  parseKdsCursorV1,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionAckV1,
  parseRealtimeSubscriptionV1,
  type BranchMembershipSummaryV1,
  type KdsCursorV1,
  type KdsTicketV1,
  type RealtimeSubscriptionV1,
  type SyncConnectivityStateV1,
} from "@super-restaurant/shared-types";

import type { KdsConfig } from "./config.js";
import { KdsRequestError, listKdsTickets, listMemberships, recoverKdsEvents, transitionKdsTicket } from "./kds-client.js";
import {
  KDS_LOCAL_ONLY_COPY,
  KDS_OFFLINE_LOCKED_COPY,
  KDS_OFFLINE_NO_NEW_TICKETS_COPY,
  buildCacheRecord,
  clearKdsCache,
  createKdsCache,
  formatLastReceived,
  overlayPendingTransitions,
  stationSelectionLocked,
  ticketsForStation,
  type KdsCachePort,
  type KdsPendingTransition,
  type KdsStationScope,
} from "./kds-local.js";
import {
  clearKdsSyncState,
  createKdsOfflineController,
  createKdsSyncHttpTransport,
  createKdsSyncStorage,
  type KdsOfflineController,
} from "./kds-offline.js";
import {
  BatchTransitionError,
  NEW_FOR_SECONDS,
  ageBucket,
  dismissKitchenReadyAlert,
  groupTicketsByOrder,
  nextKdsAction,
  orderTicketsForDisplay,
  planBatchTransition,
  recordKitchenReadyAlert,
  runBatchTransition,
  type KdsAction,
  type KdsOrderGroup,
  type KitchenReadyAlert,
} from "./kds-state.js";

type BoardConnection = "connecting" | "live" | "reconnecting" | "error";

/** Maps the realtime socket state to the sync capability connectivity vocabulary. */
function toConnectivity(value: BoardConnection): SyncConnectivityStateV1 {
  if (value === "live") return "online";
  if (value === "error") return "offline";
  return "reconnecting";
}

export function App({ config, supabase }: {
  readonly config: KdsConfig;
  readonly supabase: SupabaseClient;
}): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setCheckingSession(false); }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) { setSession(nextSession); setCheckingSession(false); }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [supabase]);

  if (checkingSession) return <main className="center-card" aria-busy="true"><p>Abriendo cocina…</p></main>;
  if (session === null) return <Login onLogin={(email, password) => supabase.auth.signInWithPassword({ email, password }).then(({ error }) => error === null)} />;
  return <Workspace config={config} session={session} onLogout={() => supabase.auth.signOut({ scope: "local" }).then(() => undefined)} />;
}

function Login({ onLogin }: { readonly onLogin: (email: string, password: string) => Promise<boolean> }): React.JSX.Element {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(false);
    const ok = await onLogin(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
    setBusy(false); setError(!ok);
  };
  return <main className="login-shell">
    <section className="login-card">
      <p className="eyebrow">superRestaurant</p><h1>Pantalla de cocina</h1>
      <p className="muted">Ingresa con tu cuenta operativa.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Correo<input name="email" type="email" autoComplete="username" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="error" role="alert">No se pudo iniciar sesión.</p>}
        <button className="primary" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button>
      </form>
    </section>
  </main>;
}

function Workspace({ config, session, onLogout }: {
  readonly config: KdsConfig;
  readonly session: Session;
  readonly onLogout: () => Promise<void>;
}): React.JSX.Element {
  const [memberships, setMemberships] = useState<readonly BranchMembershipSummaryV1[]>([]);
  const [selected, setSelected] = useState("");
  const [station, setStation] = useState(readStation);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [error, setError] = useState(false);
  const [boardConnection, setBoardConnection] = useState<BoardConnection>("connecting");

  useEffect(() => {
    let active = true;
    void listMemberships(config, session.access_token).then((result) => {
      if (!active) return;
      setMemberships(result.memberships);
      setSelected((current) => current || membershipKey(result.memberships[0]));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [config, session.access_token]);

  const membership = memberships.find((candidate) => membershipKey(candidate) === selected);
  useEffect(() => { try { window.localStorage.setItem("superRestaurant.kds.station", station); } catch { /* Storage may be unavailable. */ } }, [station]);
  const subscription = useMemo(() => membership === undefined ? undefined : parseRealtimeSubscriptionV1({
    schemaVersion: 1, scope: membership.scope, stationId: station,
  }), [membership, station]);
  const stationLocked = stationSelectionLocked(toConnectivity(boardConnection));

  const signOut = async (): Promise<void> => {
    try { await Promise.all([clearKdsCache(), clearKdsSyncState()]); } catch { /* Purge is best-effort. */ }
    await onLogout();
  };

  return <main className="workspace">
    <header className="topbar">
      <div><p className="eyebrow">superRestaurant</p><h1>KDS</h1></div>
      <div className="controls">
        <label>Sucursal<select value={selected} disabled={stationLocked} title={stationLocked ? KDS_OFFLINE_LOCKED_COPY : undefined} onChange={(event) => setSelected(event.target.value)}>
          {memberships.map((item) => <option key={membershipKey(item)} value={membershipKey(item)}>{item.restaurantName} · {item.branchName}</option>)}
        </select></label>
        <label>Estación<input value={station} maxLength={64} disabled={stationLocked} title={stationLocked ? KDS_OFFLINE_LOCKED_COPY : undefined} onChange={(event) => setStation(event.target.value)} /></label>
        <button className="ghost" type="button" aria-pressed={soundEnabled} onClick={() => setSoundEnabled((enabled) => !enabled)}>Sonido: {soundEnabled ? "sí" : "no"}</button>
        <button className="ghost" onClick={() => void signOut()}>Salir</button>
      </div>
    </header>
    {stationLocked && <section className="banner warning" role="status">{KDS_OFFLINE_LOCKED_COPY}</section>}
    {error && <section className="banner error" role="alert">No fue posible cargar tus sucursales.</section>}
    {subscription === undefined
      ? <section className="empty"><h2>Selecciona una estación válida</h2><p>Usa el identificador configurado en el menú, por ejemplo “kitchen”.</p></section>
      : <KdsBoard key={`${selected}:${station}`} config={config} accessToken={session.access_token} actorId={session.user.id} subscription={subscription} soundEnabled={soundEnabled} onAccessLost={() => void signOut()} onConnectionChange={setBoardConnection} />}
  </main>;
}

function KdsBoard({ config, accessToken, actorId, subscription, soundEnabled, onAccessLost, onConnectionChange }: {
  readonly config: KdsConfig;
  readonly accessToken: string;
  readonly actorId: string;
  readonly subscription: RealtimeSubscriptionV1;
  readonly soundEnabled: boolean;
  readonly onAccessLost: () => void;
  readonly onConnectionChange: (connection: BoardConnection) => void;
}): React.JSX.Element {
  const [tickets, setTickets] = useState<readonly KdsTicketV1[]>([]);
  const [readyAlerts, setReadyAlerts] = useState<readonly KitchenReadyAlert[]>([]);
  const [connection, setConnection] = useState<BoardConnection>("connecting");
  const [message, setMessage] = useState("");
  const [busyItem, setBusyItem] = useState<string | undefined>(undefined);
  const [busyOrder, setBusyOrder] = useState<string | undefined>(undefined);
  const [truncated, setTruncated] = useState(false);
  const [pending, setPending] = useState<readonly KdsPendingTransition[]>([]);
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const cursor = useRef<KdsCursorV1>(KDS_INITIAL_CURSOR);
  const refreshChain = useRef<Promise<void>>(Promise.resolve());
  const deviceId = useMemo(readDeviceId, []);
  const seenItems = useRef<Set<string> | undefined>(undefined);
  const ticketsRef = useRef<readonly KdsTicketV1[]>([]);
  ticketsRef.current = tickets;
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);
  const connectionRef = useRef<BoardConnection>("connecting");
  useEffect(() => { connectionRef.current = connection; onConnectionChange(connection); }, [connection, onConnectionChange]);

  const stationScope = useMemo<KdsStationScope>(() => ({
    branchId: subscription.scope.branchId,
    restaurantId: subscription.scope.restaurantId,
    stationId: subscription.stationId,
  }), [subscription]);
  const cachePort = useMemo<KdsCachePort>(() => createKdsCache(), []);
  const offlineController = useMemo<KdsOfflineController>(() => createKdsOfflineController({
    actorId,
    connectivity: () => toConnectivity(connectionRef.current),
    deviceId,
    scope: subscription.scope,
    stationId: subscription.stationId,
    storage: createKdsSyncStorage(),
    transport: createKdsSyncHttpTransport({ accessToken, apiBaseUrl: config.apiBaseUrl }),
  }), [accessToken, actorId, config.apiBaseUrl, deviceId, subscription]);
  const pendingIds = useMemo(() => new Set(pending.map((item) => item.orderItemId)), [pending]);
  const offline = connection === "reconnecting" || connection === "error";
  const serverLoadedRef = useRef(false);
  const inFlightRef = useRef<Set<string>>(new Set());
  const retryAttemptRef = useRef(0);
  const [reconcileTick, setReconcileTick] = useState(0);

  const syncPendingState = useCallback(async (): Promise<void> => {
    try { setPending(await offlineController.pendingTransitions()); } catch { /* Storage may be unavailable. */ }
  }, [offlineController]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const record = await cachePort.load(stationScope);
        if (active && !serverLoadedRef.current && record !== null) {
          // The cache is only the initial/offline snapshot; never mixed with a server result.
          cursor.current = parseKdsCursorV1(record.cursor) ?? KDS_INITIAL_CURSOR;
          setTickets(orderTicketsForDisplay(ticketsForStation(record.tickets, stationScope)));
          setLastReceivedAt(record.lastReceivedAt);
        }
      } catch { /* Cache is optional; the server list still loads. */ }
      try {
        await offlineController.init();
      } catch { /* Durable state may be unavailable; online flow still works. */ }
      if (active) await syncPendingState();
    })();
    return () => { active = false; };
  }, [cachePort, offlineController, stationScope, syncPendingState]);

  const refresh = useCallback(async (): Promise<void> => {
    let hasMore = true;
    while (hasMore) {
      const page = await recoverKdsEvents(config, accessToken, subscription, cursor.current);
      cursor.current = page.nextCursor;
      hasMore = page.hasMore;
    }
    const result = await listKdsTickets(config, accessToken, subscription);
    const nextIds = new Set(result.tickets.map((ticket) => ticket.orderItemId));
    if (soundEnabledRef.current && seenItems.current !== undefined && result.tickets.some((ticket) => !seenItems.current!.has(ticket.orderItemId))) playArrivalSound();
    seenItems.current = nextIds;
    const receivedTickets = ticketsForStation(result.tickets, stationScope);
    serverLoadedRef.current = true;
    setTickets(orderTicketsForDisplay(receivedTickets));
    setTruncated(result.truncated);
    const receivedAt = new Date();
    setLastReceivedAt(receivedAt.toISOString());
    try {
      await cachePort.save(buildCacheRecord({ scope: stationScope, tickets: receivedTickets, cursor: cursor.current, receivedAt }));
    } catch { /* Keeping the server list on screen matters more than the local copy. */ }
  }, [accessToken, cachePort, config, stationScope, subscription]);

  const enqueueRefresh = useCallback((): Promise<void> => {
    const run = async (): Promise<void> => {
      try { await refresh(); setConnection("live"); }
      catch (error: unknown) {
        if (error instanceof KdsRequestError && (error.status === 401 || error.status === 403)) onAccessLost();
        else { setConnection("error"); setMessage("No se pudo actualizar. Reintentaremos al recuperar la conexión."); }
      }
    };
    refreshChain.current = refreshChain.current.then(run, run);
    return refreshChain.current;
  }, [onAccessLost, refresh]);

  useEffect(() => {
    enqueueRefresh();
    const socket: Socket = io(`${config.apiBaseUrl}${REALTIME_NAMESPACE}`, {
      auth: { accessToken }, reconnection: true, transports: ["websocket"],
    });
    const subscribe = (): void => {
      setConnection("connecting");
      socket.emit(REALTIME_SUBSCRIBE_EVENT, subscription, (value: unknown) => {
        const acknowledgement = parseRealtimeSubscriptionAckV1(value);
        if (acknowledgement === undefined || !sameSubscription(acknowledgement, subscription)) {
          setConnection("error"); socket.disconnect(); return;
        }
        setConnection("live"); enqueueRefresh();
        socket.emit(REALTIME_KITCHEN_READY_SUBSCRIBE_EVENT, subscription, (readyAck: unknown) => {
          const parsed = parseKitchenReadySubscriptionAckV1(readyAck);
          if (
            parsed === undefined
            || parsed.stationId !== subscription.stationId
            || parsed.scope.restaurantId !== subscription.scope.restaurantId
            || parsed.scope.branchId !== subscription.scope.branchId
          ) {
            setConnection("error"); socket.disconnect();
          }
        });
      });
    };
    socket.on("connect", subscribe);
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on(REALTIME_NOTIFICATION_EVENT, (value: unknown) => {
      const notification = parseRealtimeNotificationV1(value);
      if (notification !== undefined && sameSubscription(notification, subscription)) enqueueRefresh();
    });
    socket.on(REALTIME_KITCHEN_READY_EVENT, (value: unknown) => {
      const notification = parseKitchenReadyNotificationV1(value);
      if (notification === undefined || !sameSubscription(notification, subscription)) return;
      setReadyAlerts((current) => recordKitchenReadyAlert(current, notification, subscription, ticketsRef.current));
      if (soundEnabledRef.current) playArrivalSound(880);
      enqueueRefresh();
    });
    return () => { socket.disconnect(); };
  }, [accessToken, config.apiBaseUrl, enqueueRefresh, subscription]);

  const runReconcile = useCallback(async (): Promise<void> => {
    try {
      const result = await offlineController.reconcile();
      const unavailable = result.push.failureCode === "SYNC_UNAVAILABLE" || result.pull.code === "SYNC_UNAVAILABLE";
      const confirmed = result.push.events.some((event) => event.state === "accepted" || event.state === "duplicate");
      if (unavailable) setMessage("Cambios guardados en este KDS. El servicio de sincronización aún no está disponible en este entorno.");
      else if (confirmed) setMessage("");
    } catch { /* The list refresh below still runs. */ }
    await syncPendingState();
  }, [offlineController, syncPendingState]);

  // On every reconnect: push the durable outbox and pull the cursor before refreshing the list.
  useEffect(() => {
    if (connection !== "live") return;
    let active = true;
    void (async () => {
      await runReconcile();
      if (!active) return;
      await enqueueRefresh();
    })();
    return () => { active = false; };
  }, [connection, enqueueRefresh, runReconcile]);

  // While transitions remain queued on a reachable device, retry with capped exponential backoff.
  useEffect(() => {
    if (connection !== "live" || pending.length === 0) {
      retryAttemptRef.current = 0;
      return;
    }
    let cancelled = false;
    const delay = Math.min(30_000, 1_000 * 2 ** retryAttemptRef.current);
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        await runReconcile();
        if (cancelled) return;
        retryAttemptRef.current += 1;
        setReconcileTick((tick) => tick + 1);
      })();
    }, delay);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [connection, pending.length, reconcileTick, runReconcile]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const act = async (ticket: KdsTicketV1): Promise<void> => {
    const action = nextKdsAction(ticket.status);
    if (action === undefined) return;
    if (pendingIds.has(ticket.orderItemId)) {
      setMessage("Esta comanda ya tiene un cambio guardado en este KDS; sincroniza antes de volver a avanzarla.");
      return;
    }
    if (inFlightRef.current.has(ticket.orderItemId)) return;
    inFlightRef.current.add(ticket.orderItemId);
    setBusyItem(ticket.orderItemId); setMessage("");
    try {
      if (offline) {
        const result = await offlineController.advance(ticket, action, { ticketReceivedOnStation: true });
        if (result.queued) { setMessage(KDS_LOCAL_ONLY_COPY); await syncPendingState(); }
        else setMessage(offlineReason(result.reasonCode));
        return;
      }
      await transitionKdsTicket(config, accessToken, ticket, action, deviceId);
      enqueueRefresh();
    } catch (error: unknown) {
      if (error instanceof KdsRequestError && (error.status === 401 || error.status === 403)) onAccessLost();
      else if (error instanceof KdsRequestError && error.status === 409) { setMessage("La comanda cambió en otro dispositivo. Actualizando…"); enqueueRefresh(); }
      else setMessage("No se pudo guardar el cambio. La acción no quedó en cola.");
    } finally { inFlightRef.current.delete(ticket.orderItemId); setBusyItem(undefined); }
  };

  const actOrder = async (group: KdsOrderGroup, target: KdsAction): Promise<void> => {
    const lines = planBatchTransition(group, target).filter((line) => !pendingIds.has(line.orderItemId));
    const flightKey = `order:${group.orderId}`;
    if (lines.length === 0 || inFlightRef.current.has(flightKey)) return;
    inFlightRef.current.add(flightKey);
    setBusyOrder(group.orderId); setMessage("");
    try {
      if (offline) {
        let queued = 0;
        for (const line of lines) {
          const result = await offlineController.advance(line, target, { ticketReceivedOnStation: true });
          if (result.queued) queued += 1;
        }
        await syncPendingState();
        setMessage(queued === lines.length
          ? `${queued} ${queued === 1 ? "línea guardada" : "líneas guardadas"} en este KDS. ${KDS_LOCAL_ONLY_COPY}`
          : `${queued} de ${lines.length} líneas guardadas en este KDS. Revisa las restantes antes de reintentar.`);
        return;
      }
      const completed = await runBatchTransition(lines, (line) => transitionKdsTicket(config, accessToken, line, target, deviceId));
      setMessage(`${completed} ${completed === 1 ? "línea" : "líneas"} ${target === "ready" ? completed === 1 ? "lista" : "listas" : completed === 1 ? "iniciada" : "iniciadas"}.`);
      await enqueueRefresh();
    } catch (failure: unknown) {
      const error = failure instanceof BatchTransitionError ? failure.cause : failure;
      const completed = failure instanceof BatchTransitionError ? failure.completed : 0;
      if (error instanceof KdsRequestError && (error.status === 401 || error.status === 403)) onAccessLost();
      else if (error instanceof KdsRequestError && error.status === 409) { setMessage("La orden cambió, vuelve a intentar."); await enqueueRefresh(); }
      else { setMessage(`${completed} de ${lines.length} líneas guardadas. No se pudo completar la orden; actualiza y revisa antes de reintentar.`); await enqueueRefresh(); }
    } finally { inFlightRef.current.delete(flightKey); setBusyOrder(undefined); }
  };

  const groups = groupTicketsByOrder(overlayPendingTransitions(tickets, pending));
  const lastReceivedLabel = formatLastReceived(lastReceivedAt);

  return <>
    <section className={`status ${connection}`} aria-live="polite">
      <span className="dot" />{connectionLabel(connection)} · {subscription.stationId} · {lastReceivedLabel}
      <button className="inline" onClick={enqueueRefresh}>Actualizar</button>
    </section>
    {offline && <section className="banner warning" role="status">
      Mostrando {tickets.length} {tickets.length === 1 ? "comanda guardada" : "comandas guardadas"} en esta estación · {lastReceivedLabel}
      {pending.length > 0 && ` · ${pending.length} ${pending.length === 1 ? "cambio pendiente" : "cambios pendientes"} de sincronizar`}
    </section>}
    {message && <section className="banner" role="status">{message}</section>}
    {readyAlerts.length > 0 && <section className="banner ready-banner" role="status" aria-live="polite">
      <ul className="ready-list">
        {readyAlerts.map((alert) => <li key={alert.eventId}>
          <span>{alert.summary}</span>
          <button type="button" className="ghost" onClick={() => setReadyAlerts((current) => dismissKitchenReadyAlert(current, alert.eventId))}>Descartar</button>
        </li>)}
      </ul>
    </section>}
    {truncated && <section className="banner warning" role="alert">Hay más de 500 partidas activas. Filtra la carga operativa antes de continuar.</section>}
    {tickets.length === 0
      ? offline
        ? <section className="empty"><h2>Sin comandas guardadas</h2><p>{KDS_OFFLINE_NO_NEW_TICKETS_COPY}</p></section>
        : <section className="empty"><h2>Sin comandas activas</h2><p>La pantalla se actualizará al recibir nuevos platillos.</p></section>
      : <section className="ticket-grid" aria-label="Comandas activas">
        {groups.map((group) => <article className={`ticket age-${ageBucket(group.queuedAt, now)}`} key={group.orderId}>
          <header className="order-header"><div><h2>{channelLabel(group.tickets[0]!)}</h2><small>Llegó {arrivalLabel(group.queuedAt)}</small></div><div className="order-time"><strong>{ageLabel(group.queuedAt, now)}</strong>{now - Date.parse(group.queuedAt) >= 0 && now - Date.parse(group.queuedAt) < NEW_FOR_SECONDS * 1_000 && <span className="new-pill">Nuevo</span>}</div></header>
          <div className="order-lines">{group.tickets.map((ticket) => <section className="order-line" key={ticket.orderItemId}>
            <div className="line-heading"><h3><span>{ticket.quantity}×</span> {ticket.productName}</h3><div className="line-meta"><span className={`age-chip age-${ageBucket(ticket.queuedAt, now)}`}>{ageLabel(ticket.queuedAt, now)}</span><span className="pill">{statusLabel(ticket.status)}</span>{pendingIds.has(ticket.orderItemId) && <span className="pill">Pendiente de sincronizar</span>}</div></div>
            {now - Date.parse(ticket.queuedAt) >= 0 && now - Date.parse(ticket.queuedAt) < NEW_FOR_SECONDS * 1_000 && <span className="new-pill">Nuevo</span>}
            {ticket.modifiers.length > 0 && <ul>{ticket.modifiers.map((modifier, index) => <li key={`${modifier.name}:${index}`}>{modifier.quantity > 1 ? `${modifier.quantity}× ` : ""}{modifier.name}</li>)}</ul>}
            {ticket.note !== null && <p className="note">Nota: {ticket.note}</p>}
            {nextKdsAction(ticket.status) !== undefined && <button className="ghost line-action" disabled={busyItem !== undefined || busyOrder !== undefined} title={pendingIds.has(ticket.orderItemId) ? KDS_LOCAL_ONLY_COPY : undefined} onClick={() => void act(ticket)}>{busyItem === ticket.orderItemId ? "Guardando…" : ticket.status === "sent" ? "Iniciar línea" : "Listo línea"}</button>}
          </section>)}</div>
          <footer className="order-actions">{planBatchTransition(group, "preparing").length > 0 && <button className="primary action" disabled={busyItem !== undefined || busyOrder !== undefined} onClick={() => void actOrder(group, "preparing")}>{busyOrder === group.orderId ? "Guardando…" : `Empezar todo (${planBatchTransition(group, "preparing").length})`}</button>}{planBatchTransition(group, "ready").length > 0 && <button className="primary action" disabled={busyItem !== undefined || busyOrder !== undefined} onClick={() => void actOrder(group, "ready")}>{busyOrder === group.orderId ? "Guardando…" : `Listo todo (${planBatchTransition(group, "ready").length})`}</button>}</footer>
        </article>)}
      </section>}
  </>;
}

function offlineReason(reasonCode: string | null): string {
  if (reasonCode === "TICKET_NOT_RECEIVED_ON_STATION") {
    return "Esta comanda no está guardada en esta estación; no se puede avanzar sin conexión.";
  }
  if (reasonCode === "REMOTE_ORIGIN_OFFLINE_BLOCKED") {
    return "Sin conexión no se pueden modificar comandas de otro equipo; espera a sincronizar.";
  }
  return "No se pudo guardar el cambio en este KDS.";
}

function membershipKey(membership: BranchMembershipSummaryV1 | undefined): string {
  return membership === undefined ? "" : `${membership.scope.restaurantId}:${membership.scope.branchId}`;
}

function readDeviceId(): string {
  const key = "superRestaurant.kds.deviceId";
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(stored)) return stored;
    const created = crypto.randomUUID(); window.localStorage.setItem(key, created); return created;
  } catch { return crypto.randomUUID(); }
}

function readStation(): string {
  try { return window.localStorage.getItem("superRestaurant.kds.station") || "kitchen"; } catch { return "kitchen"; }
}

function playArrivalSound(frequency = 660): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => { void context.close(); };
  } catch { /* Audio is optional. */ }
}

function sameSubscription(value: RealtimeSubscriptionV1, expected: RealtimeSubscriptionV1): boolean {
  return value.stationId === expected.stationId && value.scope.restaurantId === expected.scope.restaurantId
    && value.scope.branchId === expected.scope.branchId;
}

function connectionLabel(value: "connecting" | "live" | "reconnecting" | "error"): string {
  return { connecting: "Conectando", live: "En vivo", reconnecting: "Reconectando", error: "Sin conexión" }[value];
}
function statusLabel(value: KdsTicketV1["status"]): string { return { sent: "Nueva", preparing: "En preparación", ready: "Lista" }[value]; }
function channelLabel(ticket: KdsTicketV1): string {
  if (ticket.channel === "table") return `Mesa ${ticket.tableId?.slice(0, 6) ?? ""}`;
  return { counter: "Mostrador", delivery: "Entrega", takeout: "Para llevar" }[ticket.channel];
}
function arrivalLabel(queuedAt: string): string { return new Date(queuedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }
function ageLabel(queuedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(queuedAt)) / 60_000));
  return minutes < 1 ? "Ahora" : `${minutes} min`;
}
