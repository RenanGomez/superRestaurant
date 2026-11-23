import { randomUUID } from "node:crypto";

import { parseSyncPushRequestV1, type SyncEnvelopeV1, type SyncEventResultV1, type SyncPushResponseV1 } from "@super-restaurant/shared-types";

export interface SyncEventExecutor {
  execute(accessToken: string, event: SyncEnvelopeV1): Promise<SyncEventResultV1 | null>;
}

export interface SyncOmissionLogger {
  omitted(facts: { correlationId: string; restaurantId: string; branchId: string; deviceId: string; eventId: string; code: string }): void;
}

export class SyncPushService {
  public constructor(private readonly executor: SyncEventExecutor, private readonly logger: SyncOmissionLogger) {}

  public async push(accessToken: string, input: unknown): Promise<SyncPushResponseV1> {
    const request = parseSyncPushRequestV1(input);
    if (request === undefined) throw new Error("SYNC_REQUEST_INVALID");
    const correlationId = randomUUID();
    const results: SyncEventResultV1[] = [];
    let blocked = false;
    for (const event of request.events) {
      let code = "DEVICE_SEQUENCE_BLOCKED";
      if (!blocked) {
        try {
          const result = await this.executor.execute(accessToken, event);
          if (result !== null) { results.push(result); continue; }
          code = "TRANSIENT_RETRY";
        } catch (error: unknown) {
          if (!isTransient(error)) throw error;
          code = "CONCURRENT_RETRY";
        }
        blocked = true;
      }
      this.logger.omitted({ correlationId, restaurantId: event.restaurantId, branchId: event.branchId, deviceId: event.deviceId, eventId: event.eventId, code });
    }
    return { protocolVersion: 1, scope: request.scope, results };
  }
}

function isTransient(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "55P03" || error.code === "CONCURRENT_RETRY");
}
