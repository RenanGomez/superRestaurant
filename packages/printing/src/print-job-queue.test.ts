import assert from "node:assert/strict";
import test from "node:test";
import { MockPrinterPort, PrintJobQueue, type PrinterPort } from "./print-job-queue.js";

test("enqueue is idempotent across different payloads and destinations", () => {
  const queue = new PrintJobQueue();
  assert.equal(queue.enqueue("one", "kds", Uint8Array.of(1), 10), true);
  assert.equal(queue.enqueue("one", "reprint", Uint8Array.of(2), 11), false);
  assert.deepEqual(queue.snapshot()[0]?.bytes, [1]);
  assert.equal(queue.snapshot()[0]?.destination, "kds");
});

test("successful delivery marks delivered once and advances to the next destination", async () => {
  const queue = new PrintJobQueue();
  const port = new MockPrinterPort("kitchen");
  queue.enqueue("k", "kds", Uint8Array.of(1), 1);
  queue.enqueue("p", "printer", Uint8Array.of(2), 1);
  queue.enqueue("r", "reprint", Uint8Array.of(3), 1);
  assert.equal((await queue.deliverNext(port, 2))?.jobId, "k");
  assert.equal((await queue.deliverNext(port, 3))?.jobId, "p");
  assert.equal((await queue.deliverNext(port, 4))?.jobId, "r");
  assert.equal(await queue.deliverNext(port, 5), null);
  assert.deepEqual(queue.snapshot().map((job) => job.status), ["delivered", "delivered", "delivered"]);
  assert.deepEqual(port.writes.map((bytes) => [...bytes]), [[1], [2], [3]]);
  assert.deepEqual(port.describe(), { kind: "mock", id: "kitchen" });
});

test("failed writes expose only an abstract code", async () => {
  const queue = new PrintJobQueue();
  queue.enqueue("one", "printer", Uint8Array.of(1), 1);
  const port: PrinterPort = {
    describe: () => ({ kind: "usb", id: "secret-device" }),
    write: async () => { throw new Error("/dev/USB0 private payload"); },
  };
  const result = await queue.deliverNext(port, 2);
  assert.equal(result?.status, "failed");
  assert.equal(result?.attempts, 1);
  assert.equal(result?.lastErrorCode, "E_PORT_WRITE");
  assert.equal(JSON.stringify(queue.snapshot()).includes("USB0"), false);
});

test("retry moves failed to pending until the configured attempt limit", async () => {
  const queue = new PrintJobQueue(2);
  const port = new MockPrinterPort().failNextN(2);
  queue.enqueue("one", "printer", Uint8Array.of(1), 1);
  assert.equal((await queue.deliverNext(port, 2))?.status, "failed");
  assert.equal(queue.retry("one", 3), true);
  assert.equal(queue.snapshot()[0]?.status, "pending");
  assert.equal((await queue.deliverNext(port, 4))?.status, "failed");
  assert.equal(queue.retry("one", 5), false);
  assert.equal(await queue.deliverNext(port, 6), null);
  assert.equal(queue.snapshot()[0]?.attempts, 2);
});

test("injected failures happen exactly N times before success", async () => {
  const queue = new PrintJobQueue();
  const port = new MockPrinterPort().failNextN(2);
  queue.enqueue("one", "printer", Uint8Array.of(7), 1);
  assert.equal((await queue.deliverNext(port, 2))?.status, "failed");
  assert.equal(queue.retry("one", 3), true);
  assert.equal((await queue.deliverNext(port, 4))?.status, "failed");
  assert.equal(queue.retry("one", 5), true);
  assert.equal((await queue.deliverNext(port, 6))?.status, "delivered");
  assert.deepEqual(port.writes.map((bytes) => [...bytes]), [[7]]);
});

test("snapshot is deeply frozen and detached from queued bytes", () => {
  const queue = new PrintJobQueue();
  const bytes = Uint8Array.of(1);
  queue.enqueue("one", "kds", bytes, new Date(42));
  bytes[0] = 9;
  const snapshot = queue.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  assert.equal(Object.isFrozen(snapshot[0]?.bytes), true);
  assert.deepEqual(snapshot[0]?.bytes, [1]);
  assert.equal(snapshot[0]?.createdAt, 42);
  assert.throws(() => (snapshot as unknown as unknown[]).push("x"), TypeError);
  assert.throws(() => (snapshot[0]?.bytes as number[])[0] = 8, TypeError);
});

test("delivered jobs cannot be retried or duplicated by a second enqueue", async () => {
  const queue = new PrintJobQueue();
  const port = new MockPrinterPort();
  queue.enqueue("one", "printer", Uint8Array.of(1), 1);
  await queue.deliverNext(port, 2);
  assert.equal(queue.retry("one", 3), false);
  assert.equal(queue.enqueue("one", "printer", Uint8Array.of(2), 3), false);
  assert.equal(await queue.deliverNext(port, 4), null);
  assert.equal(port.writes.length, 1);
});

test("concurrent delivery calls claim distinct pending jobs", async () => {
  const queue = new PrintJobQueue();
  queue.enqueue("one", "kds", Uint8Array.of(1), 1);
  queue.enqueue("two", "printer", Uint8Array.of(2), 1);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const port: PrinterPort = { describe: () => ({ kind: "mock", id: "gate" }), write: async () => gate };
  const first = queue.deliverNext(port, 2);
  const second = queue.deliverNext(port, 2);
  assert.equal(await queue.deliverNext(port, 2), null);
  release?.();
  assert.deepEqual((await Promise.all([first, second])).map((job) => job?.jobId), ["one", "two"]);
});

test("invalid limits, clocks and retries are rejected", () => {
  assert.throws(() => new PrintJobQueue(0), RangeError);
  assert.throws(() => new MockPrinterPort().failNextN(-1), RangeError);
  const queue = new PrintJobQueue();
  assert.throws(() => queue.enqueue("one", "kds", Uint8Array.of(1), Number.NaN), RangeError);
  assert.equal(queue.retry("missing", 1), false);
  queue.enqueue("one", "kds", Uint8Array.of(1), 1);
  assert.equal(queue.retry("one", 2), false);
});
