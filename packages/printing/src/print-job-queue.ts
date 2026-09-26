export interface PrinterPort {
  write(bytes: Uint8Array): Promise<void>;
  describe(): { kind: "bluetooth" | "usb" | "network" | "mock"; id: string };
}

export type PrintDestination = "kds" | "printer" | "reprint";
export type PrintJobStatus = "pending" | "delivered" | "failed";

export interface PrintJobSnapshot {
  readonly jobId: string;
  readonly destination: PrintDestination;
  readonly bytes: readonly number[];
  readonly status: PrintJobStatus;
  readonly attempts: number;
  readonly lastErrorCode: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface PrintJob {
  jobId: string;
  destination: PrintDestination;
  bytes: Uint8Array;
  status: PrintJobStatus;
  attempts: number;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

function timestamp(now: Date | number): number {
  const value = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(value)) throw new RangeError("now must be a finite timestamp");
  return value;
}

function snapshotOf(job: PrintJob): Readonly<PrintJobSnapshot> {
  return Object.freeze({
    jobId: job.jobId,
    destination: job.destination,
    bytes: Object.freeze([...job.bytes]),
    status: job.status,
    attempts: job.attempts,
    lastErrorCode: job.lastErrorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

/** In-memory queue. A failed write may have reached hardware; callers must reconcile that ambiguity. */
export class PrintJobQueue {
  private readonly jobs = new Map<string, PrintJob>();
  private readonly inFlight = new Set<string>();
  public readonly maxAttempts: number;

  constructor(maxAttempts = 3) {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError("maxAttempts must be a positive safe integer");
    }
    this.maxAttempts = maxAttempts;
  }

  /** Returns false for an existing jobId, regardless of its current state or payload. */
  enqueue(jobId: string, destination: PrintDestination, bytes: Uint8Array, now: Date | number): boolean {
    const at = timestamp(now);
    if (!jobId) throw new TypeError("jobId must be nonempty");
    if (destination !== "kds" && destination !== "printer" && destination !== "reprint") {
      throw new TypeError("invalid print destination");
    }
    if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be Uint8Array");
    if (this.jobs.has(jobId)) return false;
    this.jobs.set(jobId, {
      jobId, destination, bytes: Uint8Array.from(bytes), status: "pending", attempts: 0,
      lastErrorCode: null, createdAt: at, updatedAt: at,
    });
    return true;
  }

  /** Delivers the oldest pending job once; concurrent calls cannot select the same job. */
  async deliverNext(port: PrinterPort, now: Date | number): Promise<Readonly<PrintJobSnapshot> | null> {
    const at = timestamp(now);
    const job = [...this.jobs.values()].find((item) => item.status === "pending" && !this.inFlight.has(item.jobId));
    if (!job) return null;
    this.inFlight.add(job.jobId);
    job.attempts += 1;
    try {
      await port.write(Uint8Array.from(job.bytes));
      job.status = "delivered";
      job.lastErrorCode = null;
    } catch {
      // Never persist provider messages, addresses, paths, or payloads.
      job.status = "failed";
      job.lastErrorCode = "E_PORT_WRITE";
    } finally {
      job.updatedAt = at;
      this.inFlight.delete(job.jobId);
    }
    return snapshotOf(job);
  }

  /** A failed attempt requires an explicit retry and may never exceed maxAttempts. */
  retry(jobId: string, now: Date | number): boolean {
    const at = timestamp(now);
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "failed" || job.attempts >= this.maxAttempts) return false;
    job.status = "pending";
    job.updatedAt = at;
    return true;
  }

  snapshot(): readonly Readonly<PrintJobSnapshot>[] {
    return Object.freeze([...this.jobs.values()].map(snapshotOf));
  }
}

/** Deterministic test adapter; failures never retain or expose bytes. */
export class MockPrinterPort implements PrinterPort {
  private remainingFailures = 0;
  private readonly written: Uint8Array[] = [];

  constructor(private readonly id = "mock") {}

  describe(): { kind: "mock"; id: string } {
    return { kind: "mock", id: this.id };
  }

  failNextN(count: number): this {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("count must be a nonnegative safe integer");
    this.remainingFailures = count;
    return this;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("mock write failure");
    }
    this.written.push(Uint8Array.from(bytes));
  }

  get writes(): readonly Uint8Array[] {
    return Object.freeze(this.written.map((bytes) => Uint8Array.from(bytes)));
  }
}
