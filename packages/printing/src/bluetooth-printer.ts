import type { PrinterPort } from "./print-job-queue.js";

/** The platform adapter must reject connect unless no bytes have been sent. */
export interface BluetoothTransport {
  connect(deviceId: string): Promise<BluetoothConnection>;
}

export interface BluetoothConnection {
  /** Resolves when the transport accepts all bytes, not when paper is confirmed printed. */
  write(bytes: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
}

declare function setTimeout(callback: () => void, ms: number): unknown;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Connection failures are retried; a failed write is ambiguous and is never retried here. */
export class BluetoothPrinterPort implements PrinterPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly id: string,
    private readonly transport: BluetoothTransport,
    private readonly wait: (ms: number) => Promise<void> = delay,
  ) {
    if (!id.trim()) throw new TypeError("device id must be nonempty");
  }

  describe(): { kind: "bluetooth"; id: string } {
    return { kind: "bluetooth", id: this.id };
  }

  write(bytes: Uint8Array): Promise<void> {
    const copy = Uint8Array.from(bytes);
    const operation = this.tail.then(() => this.send(copy));
    this.tail = operation.catch(() => {});
    return operation;
  }

  private async send(bytes: Uint8Array): Promise<void> {
    let connection: BluetoothConnection | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        connection = await this.transport.connect(this.id);
        break;
      } catch {
        if (attempt === 2) throw new Error("Bluetooth connection failed");
        await this.wait(100 * 2 ** attempt);
      }
    }
    if (!connection) throw new Error("Bluetooth connection failed");
    try {
      await connection.write(bytes);
    } finally {
      // Disconnect failure cannot make an accepted write safe to repeat.
      await connection.disconnect().catch(() => {});
    }
  }
}
