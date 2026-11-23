import assert from "node:assert/strict";
import test from "node:test";
import { BluetoothPrinterPort, type BluetoothTransport } from "./bluetooth-printer.js";
import { EscPosEncoder } from "./escpos.js";
import { PrintJobQueue } from "./print-job-queue.js";

test("PrinterPort contract sends ESC/POS bytes after bounded connection retries", async () => {
  const waits: number[] = [];
  const writes: number[][] = [];
  let attempts = 0;
  let disconnected = 0;
  const transport: BluetoothTransport = { connect: async (id) => {
    assert.equal(id, "printer-1");
    if (++attempts < 3) throw new Error("offline");
    return { write: async (bytes) => { writes.push([...bytes]); }, disconnect: async () => { disconnected++; } };
  } };
  const port = new BluetoothPrinterPort("printer-1", transport, async (ms) => { waits.push(ms); });
  const bytes = new EscPosEncoder().init().line("Hola").cut("partial").bytes();
  const queue = new PrintJobQueue();
  queue.enqueue("job", "printer", bytes, 1);
  assert.deepEqual(port.describe(), { kind: "bluetooth", id: "printer-1" });
  assert.equal((await queue.deliverNext(port, 2))?.status, "delivered");
  assert.deepEqual(waits, [100, 200]);
  assert.deepEqual(writes, [[...bytes]]);
  assert.equal(disconnected, 1);
});

test("connection exhaustion is bounded and never writes", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const port = new BluetoothPrinterPort("p", { connect: async () => { attempts++; throw new Error("private"); } }, async (ms) => { waits.push(ms); });
  await assert.rejects(port.write(Uint8Array.of(1)), /Bluetooth connection failed/);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [100, 200]);
});

test("disconnect during write does not resend ambiguous bytes and queue reports failure", async () => {
  let connects = 0;
  let writes = 0;
  let closes = 0;
  const port = new BluetoothPrinterPort("p", { connect: async () => {
    connects++;
    return { write: async () => { writes++; throw new Error("disconnected"); }, disconnect: async () => { closes++; throw new Error("disconnected"); } };
  } });
  const queue = new PrintJobQueue();
  queue.enqueue("job", "printer", Uint8Array.of(1), 1);
  assert.equal((await queue.deliverNext(port, 2))?.lastErrorCode, "E_PORT_WRITE");
  assert.deepEqual([connects, writes, closes], [1, 1, 1]);
});

test("concurrent writes are serialized and a failed write does not block the next", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  const port = new BluetoothPrinterPort("p", { connect: async () => {
    const current = ++count;
    events.push(`connect${current}`);
    return { write: async (bytes) => { events.push(`write${current}:${bytes[0]}`); if (current === 1) { await gate; throw new Error("lost"); } }, disconnect: async () => { events.push(`close${current}`); } };
  } });
  const first = port.write(Uint8Array.of(1));
  const data = Uint8Array.of(2);
  const second = port.write(data);
  data[0] = 9;
  await Promise.resolve();
  release();
  await assert.rejects(first);
  await second;
  assert.deepEqual(events, ["connect1", "write1:1", "close1", "connect2", "write2:2", "close2"]);
});

test("empty device identifiers are rejected", () => {
  assert.throws(() => new BluetoothPrinterPort(" ", { connect: async () => { throw new Error(); } }), TypeError);
});
