import type { DurableSyncStoragePort } from "./engine.js";
import type { DurableSyncState } from "./durable-state.js";

/**
 * Reference storage for tests. State is serialized to JSON on `persist`, so nothing aliases
 * engine memory, and a commit can be made to fail to prove atomicity.
 */
export class InMemorySyncStorage implements DurableSyncStoragePort {
  private readonly serialized = new Map<string, string>();
  private failures = 0;
  public persistCount = 0;

  /** The next `count` calls to `persist` throw before writing anything. */
  public failNextPersist(count = 1): void {
    this.failures = count;
  }

  public loadState(deviceId: string): Promise<unknown> {
    const raw = this.serialized.get(deviceId);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as unknown));
  }

  public persist(state: DurableSyncState): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error("simulated commit failure"));
    }
    this.serialized.set(state.deviceId, JSON.stringify(state));
    this.persistCount += 1;
    return Promise.resolve();
  }

  /** Raw stored snapshot, for assertions about what is durably written. */
  public rawState(deviceId: string): unknown {
    const raw = this.serialized.get(deviceId);
    return raw === undefined ? null : (JSON.parse(raw) as unknown);
  }

  /** Replaces the stored state with arbitrary data, to simulate corruption. */
  public seedRaw(deviceId: string, value: unknown): void {
    this.serialized.set(deviceId, JSON.stringify(value));
  }
}
