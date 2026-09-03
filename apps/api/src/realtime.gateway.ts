import {
  KDS_INITIAL_CURSOR,
  REALTIME_NAMESPACE,
  REALTIME_NOTIFICATION_EVENT,
  REALTIME_SUBSCRIBE_EVENT,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionV1,
  type KdsEventV1,
  type RealtimeSubscriptionAckV1,
  type RealtimeSubscriptionV1,
} from "@super-restaurant/shared-types";
import { Inject, Injectable } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { OnGatewayDisconnect, OnGatewayInit } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import {
  AUTH_PRINCIPAL_VERIFIER,
  type AuthenticatedPrincipal,
  type AuthPrincipalVerifierPort,
} from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import type { RealtimeNotificationPort } from "./orders.js";

interface RealtimeSession {
  readonly principal: AuthenticatedPrincipal;
  subscription?: RealtimeSubscriptionV1;
}

@Injectable()
@WebSocketGateway({
  maxHttpBufferSize: 16_384,
  namespace: REALTIME_NAMESPACE,
  perMessageDeflate: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  transports: ["websocket"],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect, RealtimeNotificationPort {
  readonly #sessions = new Map<Socket, RealtimeSession>();

  public constructor(
    @Inject(AUTH_PRINCIPAL_VERIFIER) private readonly verifier: AuthPrincipalVerifierPort,
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
  ) {}

  public afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket).then(() => next()).catch(() => next(new Error("AUTHENTICATION_REQUIRED")));
    });
  }

  public handleDisconnect(client: Socket): void {
    this.#sessions.delete(client);
  }

  @SubscribeMessage(REALTIME_SUBSCRIBE_EVENT)
  public async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() input: unknown,
  ): Promise<RealtimeSubscriptionAckV1 | undefined> {
    const session = this.#sessions.get(client);
    const subscription = parseRealtimeSubscriptionV1(input);
    if (session === undefined || session.subscription !== undefined || subscription === undefined) {
      client.disconnect(true);
      return undefined;
    }
    try {
      await this.authorization.authorizeBranch(session.principal, subscription.scope, "kds.read");
      session.subscription = subscription;
      await client.join(roomFor(subscription));
      return Object.freeze({ ...subscription, cursor: KDS_INITIAL_CURSOR, status: "subscribed" });
    } catch {
      client.disconnect(true);
      return undefined;
    }
  }

  public async notify(event: KdsEventV1): Promise<void> {
    const notification = parseRealtimeNotificationV1({
      cursor: event.cursor,
      eventId: event.eventId,
      eventType: "kds.changed",
      schemaVersion: 1,
      scope: event.scope,
      stationId: event.stationId,
    });
    if (notification === undefined) return;
    const deliveries = [...this.#sessions].map(async ([client, session]) => {
      const subscription = session.subscription;
      if (subscription === undefined || !matches(subscription, event)) return;
      try {
        await this.authorization.authorizeBranch(session.principal, subscription.scope, "kds.read");
        if (client.connected) client.volatile.emit(REALTIME_NOTIFICATION_EVENT, notification);
      } catch {
        await client.leave(roomFor(subscription));
        client.disconnect(true);
      }
    });
    await Promise.all(deliveries);
  }

  private async authenticate(client: Socket): Promise<void> {
    const accessToken = accessTokenFrom(client.handshake.auth);
    if (accessToken === undefined) throw new Error("AUTHENTICATION_REQUIRED");
    const principal = await this.verifier.verifyAccessToken(accessToken);
    this.#sessions.set(client, { principal: Object.freeze({ actorId: principal.actorId }) });
  }
}

function accessTokenFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== "accessToken") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, "accessToken");
    const token = descriptor !== undefined && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
    return typeof token === "string" && token.length >= 20 && token.length <= 8_192 && !/\s/u.test(token) ? token : undefined;
  } catch { return undefined; }
}

function matches(subscription: RealtimeSubscriptionV1, event: KdsEventV1): boolean {
  return subscription.scope.restaurantId === event.scope.restaurantId
    && subscription.scope.branchId === event.scope.branchId
    && subscription.stationId === event.stationId;
}

function roomFor(subscription: RealtimeSubscriptionV1): string {
  return `kds:v1:${subscription.scope.restaurantId}:${subscription.scope.branchId}:${subscription.stationId}`;
}
