import { Injectable } from "@nestjs/common";

/**
 * Server clock as an injectable port: `packages/domain` never reads the
 * clock itself (AGENTS.md §11/§8.1), and application services must not call
 * `Date.now()`/`new Date()` directly either, so every caller can be driven by
 * a deterministic double in tests.
 */
export interface ClockPort {
  /** Current instant as a UTC timestamp, `YYYY-MM-DDTHH:mm:ss.sssZ`. */
  now(): string;
}

export const SERVER_CLOCK_PORT = Symbol("SERVER_CLOCK_PORT");

@Injectable()
export class SystemClock implements ClockPort {
  public now(): string {
    return new Date().toISOString();
  }
}
