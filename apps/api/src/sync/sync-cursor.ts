import { createHmac, timingSafeEqual } from "node:crypto";

export interface CursorScope { readonly restaurantId: string; readonly branchId: string; readonly actorId: string }
interface Payload extends CursorScope { readonly v: 1; readonly sequence: string; readonly expires: number }

export class SyncCursor {
  public constructor(private readonly key: string, private readonly now: () => number = Date.now) {

  }
  public encode(scope: CursorScope, sequence: string): string {
    const body = Buffer.from(JSON.stringify({ v: 1, ...scope, sequence, expires: this.now() + 30 * 86400_000 })).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }
  public decode(cursor: string, scope: CursorScope): string {
    const [body, signature, extra] = cursor.split(".");
    if (!body || !signature || extra !== undefined) throw new Error("CURSOR_SCOPE_MISMATCH");
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("CURSOR_SCOPE_MISMATCH");
    let value: Payload;
    try { value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload; } catch { throw new Error("CURSOR_SCOPE_MISMATCH"); }
    if (value === null || value.v !== 1 || value.restaurantId !== scope.restaurantId || value.branchId !== scope.branchId || value.actorId !== scope.actorId || typeof value.sequence !== "string" || !/^(0|[1-9][0-9]{0,18})$/u.test(value.sequence) || BigInt(value.sequence) > 9223372036854775807n || !Number.isSafeInteger(value.expires)) throw new Error("CURSOR_SCOPE_MISMATCH");
    if (value.expires <= this.now()) throw new Error("CURSOR_EXPIRED");
    return value.sequence;
  }
  private sign(body: string): string { if (Buffer.byteLength(this.key, "utf8") < 32) throw new Error("SYNC_CURSOR_SECRET_INVALID"); return createHmac("sha256", this.key).update(body).digest("base64url"); }
}
