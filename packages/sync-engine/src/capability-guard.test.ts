import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEnvelopeCapability,
  assertOfflineCapability,
  evaluateEnvelopeCapability,
  evaluateOfflineCapability,
} from "./capability-guard.js";
import { DeviceSyncEngine } from "./engine.js";
import { SyncEngineError } from "./errors.js";
import { InMemorySyncStorage } from "./in-memory-storage.js";
import { ACTOR, DEVICE, FakeClock, FakeServer, SCOPE_A1, SequentialIds, id, orderInput } from "./testkit.js";

test("operaciones fuera de Fase 3 y borrado fisico siempre se bloquean en todos los clientes y estados de red", () => {
  for (const action of [
    "payment.gateway_or_terminal_integrated",
    "payment.refund_or_void",
    "fiscal.cfdi_stamp",
    "inventory.adjust_or_receive",
  ] as const) {
    for (const clientType of ["web_pos", "mobile", "kds"] as const) {
      for (const connectivity of ["online", "degraded", "offline", "reconnecting", "sync_blocked"] as const) {
        const decision = evaluateOfflineCapability({ clientType, connectivity, action });
        assert.equal(decision.allowed, false, `${action}/${clientType}/${connectivity}`);
        assert.equal(decision.reasonCode, "PHASE3_UNSUPPORTED");
      }
    }
  }
  const physicalDelete = evaluateOfflineCapability({
    clientType: "web_pos",
    connectivity: "online",
    action: "entity.physical_delete",
  });
  assert.equal(physicalDelete.allowed, false);
  assert.equal(physicalDelete.reasonCode, "PHYSICAL_DELETE_FORBIDDEN");
});

test("Web POS y Mobile permiten orden local offline con advertencia localOnlyWarning, pero bloquean editar orden remota y supervisor offline", () => {
  for (const clientType of ["web_pos", "mobile"] as const) {
    const createOffline = evaluateOfflineCapability({
      clientType,
      connectivity: "offline",
      action: "order.create_local",
      preconditions: { hasCatalogSnapshots: true },
    });
    assert.equal(createOffline.allowed, true);
    assert.equal(createOffline.mode, "conditional");
    assert.equal(createOffline.localOnlyWarning, true);
    assert.equal(createOffline.requiresServerRevalidation, true);

    const noSnapshots = evaluateOfflineCapability({
      clientType,
      connectivity: "offline",
      action: "order.create_local",
      preconditions: { hasCatalogSnapshots: false },
    });
    assert.equal(noSnapshots.allowed, false);
    assert.equal(noSnapshots.reasonCode, "SNAPSHOTS_REQUIRED");

    const remoteEdit = evaluateOfflineCapability({
      clientType,
      connectivity: "offline",
      action: "order.edit_remote_origin",
    });
    assert.equal(remoteEdit.allowed, false);
    assert.equal(remoteEdit.reasonCode, "REMOTE_ORIGIN_OFFLINE_BLOCKED");

    const supervisorOffline = evaluateOfflineCapability({
      clientType,
      connectivity: "reconnecting",
      action: "discount.apply_supervisor_or_reopen",
    });
    assert.equal(supervisorOffline.allowed, false);
    assert.equal(supervisorOffline.reasonCode, "SUPERVISOR_REQUIRED_ONLINE");

    const cashCloseOffline = evaluateOfflineCapability({
      clientType,
      connectivity: "offline",
      action: "cash_register.close_or_reopen",
    });
    assert.equal(cashCloseOffline.allowed, false);
    assert.equal(cashCloseOffline.reasonCode, "OFFLINE_NOT_SUPPORTED");
  }
});

test("KDS solo puede avanzar tickets ya recibidos en offline y bloquea ordenes, pagos y reasignacion offline", () => {
  const advanceOk = evaluateOfflineCapability({
    clientType: "kds",
    connectivity: "offline",
    action: "kds.advance_received_ticket",
    preconditions: { ticketReceivedOnStation: true },
  });
  assert.equal(advanceOk.allowed, true);
  assert.equal(advanceOk.localOnlyWarning, true);

  const notReceived = evaluateOfflineCapability({
    clientType: "kds",
    connectivity: "offline",
    action: "kds.advance_received_ticket",
    preconditions: { ticketReceivedOnStation: false },
  });
  assert.equal(notReceived.allowed, false);
  assert.equal(notReceived.reasonCode, "TICKET_NOT_RECEIVED_ON_STATION");

  const reassignOffline = evaluateOfflineCapability({
    clientType: "kds",
    connectivity: "offline",
    action: "kds.reassign_station",
  });
  assert.equal(reassignOffline.allowed, false);
  assert.equal(reassignOffline.reasonCode, "OFFLINE_NOT_SUPPORTED");

  const kdsOrder = evaluateEnvelopeCapability({
    clientType: "kds",
    connectivity: "online",
    entityType: "Order",
    operation: "create",
  });
  assert.equal(kdsOrder.allowed, false);
  assert.equal(kdsOrder.reasonCode, "CLIENT_NOT_SUPPORTED");
});

test("pagos offline: efectivo exige caja/turno y limite; card_manual exige terminal externa y nunca captured; pasarela y refund siempre bloqueados", () => {
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "offline",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "cash", amountMinor: 5000, currency: "MXN" },
      preconditions: { cashRegisterOpen: true, cashierShiftOpen: true, withinOfflineCashLimit: true },
    }).allowed,
    true,
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "offline",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "cash", amountMinor: 5000, currency: "MXN" },
      preconditions: { cashRegisterOpen: false },
    }).reasonCode,
    "CASH_REGISTER_REQUIRED",
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "offline",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "card_manual", status: "captured" },
      preconditions: { externalTerminalConfirmed: true },
    }).reasonCode,
    "CARD_MANUAL_CANNOT_CAPTURE_OFFLINE",
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "offline",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "card_manual", status: "recorded" },
      preconditions: { externalTerminalConfirmed: false },
    }).reasonCode,
    "EXTERNAL_TERMINAL_CONFIRMATION_REQUIRED",
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "offline",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "card_manual", status: "recorded" },
      preconditions: { externalTerminalConfirmed: true },
    }).allowed,
    true,
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "online",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "card_gateway" },
    }).reasonCode,
    "PHASE3_UNSUPPORTED",
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "online",
      entityType: "Refund",
      operation: "create",
    }).reasonCode,
    "PHASE3_UNSUPPORTED",
  );
});

test("assertOfflineCapability y assertEnvelopeCapability lanzan CAPABILITY_BLOCKED al bloquear", () => {
  assert.throws(
    () => assertOfflineCapability({ clientType: "web_pos", connectivity: "offline", action: "cash_register.close_or_reopen" }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  assert.throws(
    () => assertEnvelopeCapability({ clientType: "kds", connectivity: "online", entityType: "Payment", operation: "create" }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
});

test("DeviceSyncEngine aplica la matriz de capacidades en enqueue sin consumir secuencia al bloquear", async () => {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const engine = new DeviceSyncEngine({
    deviceId: DEVICE,
    storage,
    transport: server,
    ids: new SequentialIds(),
    clock: new FakeClock(),
    clientType: "web_pos",
    connectivity: "offline",
  });

  // Remote-origin order pulled while previously online: cannot be edited offline.
  const remoteOrderId = id(0x4100);
  server.inject(SCOPE_A1, {
    entityType: "Order",
    entityId: remoteOrderId,
    canonicalVersion: 1,
    tombstone: false,
    snapshot: { note: "from-other-device" },
  });
  await engine.pull(SCOPE_A1);

  const checkRemote = await engine.canEnqueue({
    ...orderInput(SCOPE_A1, "edit-remote"),
    entityId: remoteOrderId,
    operation: "update",
    payload: { note: "offline-edit" },
  });
  assert.equal(checkRemote.allowed, false);
  assert.equal(checkRemote.reasonCode, "REMOTE_ORIGIN_OFFLINE_BLOCKED");

  await assert.rejects(
    engine.enqueue({
      ...orderInput(SCOPE_A1, "edit-remote"),
      entityId: remoteOrderId,
      operation: "update",
      payload: { note: "offline-edit" },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 0);

  // Local-origin order CAN be created and edited offline with snapshots; sequence starts cleanly at 1.
  const localOrder = await engine.enqueue({
    ...orderInput(SCOPE_A1, "local-1"),
    preconditions: { hasCatalogSnapshots: true },
  });
  assert.equal(localOrder.localSequence, 1);
  const localEdit = await engine.enqueue({
    ...orderInput(SCOPE_A1, "local-1-edit"),
    entityId: localOrder.entityId,
    operation: "update",
    payload: { note: "edited-locally" },
    preconditions: { hasCatalogSnapshots: true },
  });
  assert.equal(localEdit.localSequence, 2);

  // Refund is blocked even after switching online.
  engine.setConnectivity("online");
  await assert.rejects(
    engine.enqueue({
      scope: SCOPE_A1,
      actorId: ACTOR,
      entityType: "Refund",
      entityId: id(0x4200),
      operation: "create",
      idempotencyKey: "refund-1",
      payload: { amountMinor: 500, currency: "MXN" },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 2);
});

test("fail-closed: precondiciones omitidas en cash offline y operaciones offline bloquean en lugar de permitir", () => {
  // Cash offline with omitted preconditions -> blocked.
  assert.equal(
    evaluateOfflineCapability({
      clientType: "web_pos",
      connectivity: "offline",
      action: "payment.cash_collect",
    }).reasonCode,
    "CASH_REGISTER_REQUIRED",
  );
  assert.equal(
    evaluateOfflineCapability({
      clientType: "web_pos",
      connectivity: "offline",
      action: "payment.cash_collect",
      preconditions: { cashRegisterOpen: true },
    }).reasonCode,
    "CASH_REGISTER_REQUIRED",
  );
  assert.equal(
    evaluateOfflineCapability({
      clientType: "web_pos",
      connectivity: "offline",
      action: "payment.cash_collect",
      preconditions: { cashRegisterOpen: true, cashierShiftOpen: true },
    }).reasonCode,
    "OFFLINE_CASH_LIMIT_EXCEEDED",
  );
  assert.equal(
    evaluateEnvelopeCapability({
      clientType: "web_pos",
      connectivity: "offline",
      entityType: "Payment",
      operation: "create",
      payload: { paymentMethod: "cash", amountMinor: 5000, currency: "MXN" },
    }).reasonCode,
    "CASH_REGISTER_REQUIRED",
  );

  // Mobile cash even online requires cashRegisterOpen + cashierShiftOpen === true.
  assert.equal(
    evaluateOfflineCapability({
      clientType: "mobile",
      connectivity: "online",
      action: "payment.cash_collect",
    }).reasonCode,
    "CASH_REGISTER_REQUIRED",
  );

  // Order create/edit, discount, KDS advance, print local offline all fail closed when preconditions are omitted.
  assert.equal(
    evaluateOfflineCapability({ clientType: "web_pos", connectivity: "offline", action: "order.create_local" }).reasonCode,
    "SNAPSHOTS_REQUIRED",
  );
  assert.equal(
    evaluateOfflineCapability({
      clientType: "web_pos",
      connectivity: "offline",
      action: "order.edit_local_origin",
      preconditions: { hasCatalogSnapshots: true },
    }).reasonCode,
    "REMOTE_ORIGIN_OFFLINE_BLOCKED",
  );
  assert.equal(
    evaluateOfflineCapability({ clientType: "web_pos", connectivity: "offline", action: "discount.apply_standard" }).reasonCode,
    "LOCAL_RULE_LIMIT_EXCEEDED",
  );
  assert.equal(
    evaluateOfflineCapability({ clientType: "kds", connectivity: "offline", action: "kds.advance_received_ticket" }).reasonCode,
    "TICKET_NOT_RECEIVED_ON_STATION",
  );
  assert.equal(
    evaluateOfflineCapability({ clientType: "web_pos", connectivity: "offline", action: "ticket.print_local" }).reasonCode,
    "TEMPLATE_CACHE_REQUIRED",
  );
});

test("los valores derivados por el motor (originatedOnThisDevice, entityBlocked) no pueden sobrescribirse desde input.preconditions", async () => {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const engine = new DeviceSyncEngine({
    deviceId: DEVICE,
    storage,
    transport: server,
    ids: new SequentialIds(),
    clock: new FakeClock(),
    clientType: "web_pos",
    connectivity: "offline",
  });

  // Remote-origin order pulled from server: caller attempting to forge originatedOnThisDevice: true MUST still be blocked.
  const remoteId = id(0x4300);
  server.inject(SCOPE_A1, {
    entityType: "Order",
    entityId: remoteId,
    canonicalVersion: 1,
    tombstone: false,
    snapshot: { note: "remote" },
  });
  await engine.pull(SCOPE_A1);

  await assert.rejects(
    engine.enqueue({
      ...orderInput(SCOPE_A1, "spoof-origin"),
      entityId: remoteId,
      operation: "update",
      payload: { note: "hijack" },
      preconditions: { originatedOnThisDevice: true, hasCatalogSnapshots: true },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );

  // Conflict-blocked entity under sync_blocked: caller attempting to forge entityBlocked: false MUST still be blocked.
  engine.setConnectivity("online");
  const conflictId = id(0x4301);
  await engine.enqueue({ ...orderInput(SCOPE_A1, "conf-1"), entityId: conflictId });
  server.conflictEntities.add(conflictId);
  await engine.push(SCOPE_A1);

  engine.setConnectivity("sync_blocked");
  const decision = await engine.canEnqueue({
    ...orderInput(SCOPE_A1, "spoof-unblock"),
    entityId: conflictId,
    operation: "update",
    payload: { note: "bypass" },
    preconditions: { entityBlocked: false, hasCatalogSnapshots: true, underlyingConnectivity: "online" },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "SYNC_BLOCKED_ENTITY");
  await assert.rejects(
    engine.enqueue({
      ...orderInput(SCOPE_A1, "spoof-unblock"),
      entityId: conflictId,
      operation: "update",
      payload: { note: "bypass" },
      preconditions: { entityBlocked: false, hasCatalogSnapshots: true, underlyingConnectivity: "online" },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
});

test("ausencia de clientType en DeviceSyncEngine bloquea operaciones financieras y clientType configurado no se puede falsificar por llamada", async () => {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const untyped = new DeviceSyncEngine({
    deviceId: DEVICE,
    storage,
    transport: server,
    ids: new SequentialIds(),
    clock: new FakeClock(),
  });

  const payCheck = await untyped.canEnqueue({
    scope: SCOPE_A1,
    actorId: ACTOR,
    entityType: "Payment",
    entityId: id(0x4400),
    operation: "create",
    idempotencyKey: "untyped-pay",
    payload: { paymentMethod: "cash", amountMinor: 1000, currency: "MXN" },
  });
  assert.equal(payCheck.allowed, false);
  assert.equal(payCheck.reasonCode, "CLIENT_NOT_SUPPORTED");

  await assert.rejects(
    untyped.enqueue({
      scope: SCOPE_A1,
      actorId: ACTOR,
      entityType: "Payment",
      entityId: id(0x4400),
      operation: "create",
      idempotencyKey: "untyped-pay",
      payload: { paymentMethod: "cash", amountMinor: 1000, currency: "MXN" },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  await assert.rejects(
    untyped.enqueue({
      scope: SCOPE_A1,
      actorId: ACTOR,
      entityType: "CashMovement",
      entityId: id(0x4401),
      operation: "create",
      idempotencyKey: "untyped-cash",
      payload: { amountMinor: 500, currency: "MXN" },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  assert.equal((await untyped.getOutbox(SCOPE_A1)).length, 0);

  // Configured KDS engine cannot be spoofed with per-call clientType: "web_pos".
  const kdsEngine = new DeviceSyncEngine({
    deviceId: DEVICE,
    clientType: "kds",
    connectivity: "online",
    storage: new InMemorySyncStorage(),
    transport: server,
    ids: new SequentialIds(),
    clock: new FakeClock(),
  });
  await assert.rejects(
    kdsEngine.enqueue({
      scope: SCOPE_A1,
      actorId: ACTOR,
      entityType: "Payment",
      entityId: id(0x4402),
      operation: "create",
      idempotencyKey: "kds-spoof-pay",
      payload: { paymentMethod: "cash", amountMinor: 500, currency: "MXN" },
      clientType: "web_pos",
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
});

test("reintento tras CAPABILITY_BLOCKED por precondicion omitida en cash offline no consume localSequence", async () => {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const engine = new DeviceSyncEngine({
    deviceId: DEVICE,
    clientType: "web_pos",
    connectivity: "offline",
    storage,
    transport: server,
    ids: new SequentialIds(),
    clock: new FakeClock(),
  });

  const order = await engine.enqueue({
    ...orderInput(SCOPE_A1, "seq-order-1"),
    preconditions: { hasCatalogSnapshots: true },
  });
  assert.equal(order.localSequence, 1);

  const paymentInput = {
    scope: SCOPE_A1,
    actorId: ACTOR,
    entityType: "Payment",
    entityId: id(0x4500),
    operation: "create",
    idempotencyKey: "cash-offline-retry",
    payload: { paymentMethod: "cash", amountMinor: 2500, currency: "MXN" },
  };

  // Attempt 1: omitted preconditions -> blocked; persistCount and sequence unchanged.
  const persistsBefore = storage.persistCount;
  await assert.rejects(
    engine.enqueue(paymentInput),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  // Attempt 2: missing withinOfflineCashLimit -> blocked; sequence still unchanged.
  await assert.rejects(
    engine.enqueue({ ...paymentInput, preconditions: { cashRegisterOpen: true, cashierShiftOpen: true } }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED",
  );
  assert.equal(storage.persistCount, persistsBefore);
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 1);

  // Attempt 3: valid preconditions -> succeeds at localSequence 2 (no gap!).
  const acceptedLocal = await engine.enqueue({
    ...paymentInput,
    preconditions: { cashRegisterOpen: true, cashierShiftOpen: true, withinOfflineCashLimit: true },
  });
  assert.equal(acceptedLocal.localSequence, 2);
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 2);
});
