import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { io, type Socket } from "socket.io-client";
import {
  KDS_INITIAL_CURSOR,
  REALTIME_NAMESPACE,
  REALTIME_NOTIFICATION_EVENT,
  REALTIME_SUBSCRIBE_EVENT,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionAckV1,
  parseRealtimeSubscriptionV1,
  type BranchMembershipSummaryV1,
  type KdsCursorV1,
  type KdsTicketV1,
  type RealtimeSubscriptionV1,
} from "@super-restaurant/shared-types";

import type { KdsConfig } from "./config.js";
import { KdsRequestError, listKdsTickets, listMemberships, recoverKdsEvents, transitionKdsTicket } from "./kds-client.js";
import { nextKdsAction, orderTicketsForDisplay } from "./kds-state.js";

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
  const [station, setStation] = useState("kitchen");
  const [error, setError] = useState(false);

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
  const subscription = useMemo(() => membership === undefined ? undefined : parseRealtimeSubscriptionV1({
    schemaVersion: 1, scope: membership.scope, stationId: station,
  }), [membership, station]);

  return <main className="workspace">
    <header className="topbar">
      <div><p className="eyebrow">superRestaurant</p><h1>KDS</h1></div>
      <div className="controls">
        <label>Sucursal<select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {memberships.map((item) => <option key={membershipKey(item)} value={membershipKey(item)}>{item.restaurantName} · {item.branchName}</option>)}
        </select></label>
        <label>Estación<input value={station} maxLength={64} onChange={(event) => setStation(event.target.value)} /></label>
        <button className="ghost" onClick={() => void onLogout()}>Salir</button>
      </div>
    </header>
    {error && <section className="banner error" role="alert">No fue posible cargar tus sucursales.</section>}
    {subscription === undefined
      ? <section className="empty"><h2>Selecciona una estación válida</h2><p>Usa el identificador configurado en el menú, por ejemplo “kitchen”.</p></section>
      : <KdsBoard key={`${selected}:${station}`} config={config} accessToken={session.access_token} subscription={subscription} onAccessLost={() => void onLogout()} />}
  </main>;
}

function KdsBoard({ config, accessToken, subscription, onAccessLost }: {
  readonly config: KdsConfig;
  readonly accessToken: string;
  readonly subscription: RealtimeSubscriptionV1;
  readonly onAccessLost: () => void;
}): React.JSX.Element {
  const [tickets, setTickets] = useState<readonly KdsTicketV1[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting" | "error">("connecting");
  const [message, setMessage] = useState("");
  const [busyItem, setBusyItem] = useState<string | undefined>(undefined);
  const [truncated, setTruncated] = useState(false);
  const [now, setNow] = useState(Date.now());
  const cursor = useRef<KdsCursorV1>(KDS_INITIAL_CURSOR);
  const refreshChain = useRef<Promise<void>>(Promise.resolve());
  const deviceId = useMemo(readDeviceId, []);

  const refresh = useCallback(async (): Promise<void> => {
    let hasMore = true;
    while (hasMore) {
      const page = await recoverKdsEvents(config, accessToken, subscription, cursor.current);
      cursor.current = page.nextCursor;
      hasMore = page.hasMore;
    }
    const result = await listKdsTickets(config, accessToken, subscription);
    setTickets(orderTicketsForDisplay(result.tickets));
    setTruncated(result.truncated);
    setMessage("");
  }, [accessToken, config, subscription]);

  const enqueueRefresh = useCallback(() => {
    const run = async (): Promise<void> => {
      try { await refresh(); setConnection("live"); }
      catch (error: unknown) {
        if (error instanceof KdsRequestError && (error.status === 401 || error.status === 403)) onAccessLost();
        else { setConnection("error"); setMessage("No se pudo actualizar. Reintentaremos al recuperar la conexión."); }
      }
    };
    refreshChain.current = refreshChain.current.then(run, run);
  }, [onAccessLost, refresh]);

  useEffect(() => {
    cursor.current = KDS_INITIAL_CURSOR;
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
      });
    };
    socket.on("connect", subscribe);
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on(REALTIME_NOTIFICATION_EVENT, (value: unknown) => {
      const notification = parseRealtimeNotificationV1(value);
      if (notification !== undefined && sameSubscription(notification, subscription)) enqueueRefresh();
    });
    return () => { socket.disconnect(); };
  }, [accessToken, config.apiBaseUrl, enqueueRefresh, subscription]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const act = async (ticket: KdsTicketV1): Promise<void> => {
    const action = nextKdsAction(ticket.status);
    if (action === undefined) return;
    setBusyItem(ticket.orderItemId); setMessage("");
    try { await transitionKdsTicket(config, accessToken, ticket, action, deviceId); enqueueRefresh(); }
    catch (error: unknown) {
      if (error instanceof KdsRequestError && (error.status === 401 || error.status === 403)) onAccessLost();
      else if (error instanceof KdsRequestError && error.status === 409) { setMessage("La comanda cambió en otro dispositivo. Actualizando…"); enqueueRefresh(); }
      else setMessage("No se pudo guardar el cambio. La acción no quedó en cola.");
    } finally { setBusyItem(undefined); }
  };

  return <>
    <section className={`status ${connection}`} aria-live="polite">
      <span className="dot" />{connectionLabel(connection)} · {subscription.stationId}
      <button className="inline" onClick={enqueueRefresh}>Actualizar</button>
    </section>
    {message && <section className="banner error" role="alert">{message}</section>}
    {truncated && <section className="banner warning" role="alert">Hay más de 500 partidas activas. Filtra la carga operativa antes de continuar.</section>}
    {tickets.length === 0
      ? <section className="empty"><h2>Sin comandas activas</h2><p>La pantalla se actualizará al recibir nuevos platillos.</p></section>
      : <section className="ticket-grid" aria-label="Comandas activas">
        {tickets.map((ticket) => <article className={`ticket ${ticket.status}`} key={ticket.orderItemId}>
          <header><span>{channelLabel(ticket)}</span><strong>{ageLabel(ticket.queuedAt, now)}</strong></header>
          <h2><span>{ticket.quantity}×</span> {ticket.productName}</h2>
          {ticket.modifiers.length > 0 && <ul>{ticket.modifiers.map((modifier, index) => <li key={`${modifier.name}:${index}`}>{modifier.quantity > 1 ? `${modifier.quantity}× ` : ""}{modifier.name}</li>)}</ul>}
          <footer>
            <span className="pill">{statusLabel(ticket.status)}</span>
            {nextKdsAction(ticket.status) !== undefined && <button className="primary action" disabled={busyItem !== undefined} onClick={() => void act(ticket)}>
              {busyItem === ticket.orderItemId ? "Guardando…" : ticket.status === "sent" ? "Iniciar" : "Marcar listo"}
            </button>}
          </footer>
        </article>)}
      </section>}
  </>;
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
  return { counter: "Mostrador", delivery: "Delivery", takeout: "Para llevar" }[ticket.channel];
}
function ageLabel(queuedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(queuedAt)) / 60_000));
  return minutes < 1 ? "Ahora" : `${minutes} min`;
}
