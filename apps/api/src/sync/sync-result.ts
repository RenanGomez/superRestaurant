import { parseSyncEventResultV1, type SyncEnvelopeV1, type SyncEventResultV1 } from "@super-restaurant/shared-types";

/** Converts ledger replies without trusting identifiers saved with an earlier request. */
export function syncLedgerResult(event: SyncEnvelopeV1, value: unknown): SyncEventResultV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("SYNC_LEDGER_RESULT_INVALID");
  const reply = value as Record<string, unknown>;
  if (reply["status"] === "retry_wait" || reply["code"] === "CONCURRENT_RETRY") return null;
  const status = reply["status"];
  if (status === "denied") return result(event, "rejected", "ACTION_NOT_AUTHORIZED", null, null);
  if (status === "rejected") {
    const code = typeof reply["code"] === "string" ? reply["code"] : "SYNC_REJECTED";
    return result(event, "rejected", code, null, null);
  }
  if (status !== "recorded" && status !== "duplicate") throw new Error("SYNC_LEDGER_RESULT_INVALID");
  const stored = reply["result"];
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) throw new Error("SYNC_LEDGER_RESULT_INVALID");
  const fields = stored as Record<string, unknown>;
  const parsed = parseSyncEventResultV1({
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    status: fields["status"],
    code: fields["code"],
    canonicalVersion: fields["canonicalVersion"],
    auditId: fields["auditId"],
  });
  if (parsed === undefined) throw new Error("SYNC_LEDGER_RESULT_INVALID");
  return status === "duplicate" && parsed.status === "accepted" ? { ...parsed, status: "duplicate" } : parsed;
}

function result(event: SyncEnvelopeV1, status: "rejected", code: string, canonicalVersion: null, auditId: null): SyncEventResultV1 {
  const parsed = parseSyncEventResultV1({ eventId: event.eventId, idempotencyKey: event.idempotencyKey, status, code, canonicalVersion, auditId });
  if (parsed === undefined) throw new Error("SYNC_LEDGER_RESULT_INVALID");
  return parsed;
}
