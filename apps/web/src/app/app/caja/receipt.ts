import { createHmac, timingSafeEqual } from "node:crypto";

import { parsePaymentCollectionSummaryV1, type PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";

export const CASH_RECEIPT_COOKIE = "sr-cash-receipt";
const RECEIPT_LIFETIME_MS = 60 * 60 * 1_000;

/** Bind the server-returned receipt to the current authenticated session. */
export function encodeReceiptCookie(summary: PaymentCollectionSummaryV1, accessToken: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ issuedAt: now, summary }), "utf8").toString("base64url");
  const signature = createHmac("sha256", accessToken).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeReceiptCookie(value: string | undefined, accessToken: string, now = Date.now()): PaymentCollectionSummaryV1 | undefined {
  if (value === undefined || value.length > 4_000) return undefined;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0] ?? "") || !/^[A-Za-z0-9_-]+$/u.test(parts[1] ?? "")) return undefined;
  const [payload, signature] = parts as [string, string];
  const expected = createHmac("sha256", accessToken).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const envelope = parsed as Record<string, unknown>;
    const issuedAt = envelope.issuedAt;
    if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)
      || issuedAt > now || now - issuedAt > RECEIPT_LIFETIME_MS) return undefined;
    return parsePaymentCollectionSummaryV1(envelope.summary);
  } catch { return undefined; }
}
