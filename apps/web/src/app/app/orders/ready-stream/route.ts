import { cookies } from "next/headers";
import {
  REALTIME_NAMESPACE,
  decodeKitchenReadyWireFrame,
  encodeKitchenReadySubscribeFrame,
  encodeRealtimeConnectFrame,
  kitchenReadyMatchesSubscription,
  parseKitchenReadySubscriptionV1,
  realtimeWebSocketUrl,
} from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../../env";
import { authorizeBranch } from "../../../../lib/branch-selection";
import { BRANCH_PREFERENCE_COOKIE, parseBranchPreference } from "../../../../lib/memberships";
import { createServerSupabaseClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-side SSE bridge over `/realtime/v1` so tokens and API URLs never reach the browser. */
export async function GET(request: Request): Promise<Response> {
  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return new Response(null, { status: 403 });
  const rawStation = new URL(request.url).searchParams.get("stationId");
  const subscription = parseKitchenReadySubscriptionV1({
    schemaVersion: 1,
    scope,
    stationId: rawStation === null || rawStation === "" ? null : rawStation,
  });
  if (subscription === undefined) return new Response(null, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return new Response(null, { status: 401 });
  const env = getServerEnv();
  if (await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    return new Response(null, { status: 403 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const ws = new WebSocket(realtimeWebSocketUrl(env.apiBaseUrl));
      const keepalive = setInterval(() => {
        if (!closed) try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { close(); }
      }, 20_000);
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        request.signal.removeEventListener("abort", close);
        try { if (ws.readyState === WebSocket.OPEN) ws.send(`41${REALTIME_NAMESPACE},`); ws.close(); } catch { /* ignore */ }
        try { controller.close(); } catch { /* ignore */ }
      };
      cleanup = close;
      const send = (event: string, data: unknown): void => {
        if (!closed) try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { close(); }
      };
      request.signal.addEventListener("abort", close);
      ws.addEventListener("error", close);
      ws.addEventListener("close", close);
      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        const decoded = decodeKitchenReadyWireFrame(event.data);
        if (decoded.kind === "open") ws.send(encodeRealtimeConnectFrame(session.access_token));
        else if (decoded.kind === "ping") ws.send("3");
        else if (decoded.kind === "connected") ws.send(encodeKitchenReadySubscribeFrame(subscription));
        else if (decoded.kind === "ack") {
          const valid = decoded.ack !== undefined
            && decoded.ack.scope.restaurantId === scope.restaurantId
            && decoded.ack.scope.branchId === scope.branchId
            && decoded.ack.stationId === subscription.stationId;
          if (!valid) { close(); return; }
          send("subscribed", { stationId: decoded.ack.stationId });
        } else if (decoded.kind === "ready" && decoded.notification !== undefined && kitchenReadyMatchesSubscription(subscription, decoded.notification)) {
          send("ready", decoded.notification);
        } else if (decoded.kind === "closed") close();
      });
    },
    cancel() { cleanup?.(); },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
