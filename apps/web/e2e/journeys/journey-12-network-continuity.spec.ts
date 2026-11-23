import {
  assertAppPage, beforeJourney, expect, openRegisterForRun, payExactCash, requireActiveShift, requireOrderSeed, test,
} from "../fixtures/journey-test.ts";

test("journey 12: continuar sin red y reconectar sin perder ni duplicar el cobro", async ({ page, api, cleanup, diag }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);
  const shiftId = await requireActiveShift(api);

  const seeded = await api.seedOrder();
  cleanup.add("cancelar la orden del journey 12 si quedó sin cobrar", () => api.cancelIfUnpaid(seeded.orderId));
  await openRegisterForRun(page, api, cleanup, shiftId, 0, "journey 12");

  await page.goto(`/app/caja?orderId=${encodeURIComponent(seeded.orderId)}`);
  await assertAppPage(page, "/app/caja");
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();

  // Get a valid server quote while online, then lose the network before confirming the charge.
  await page.getByRole("button", { name: "Exacto" }).click();
  await expect(page.getByText(/Cambio después de propina/u)).toBeVisible({ timeout: 20_000 });
  await page.context().setOffline(true);
  try {
    await page.getByRole("button", { name: "Cobrar", exact: true }).click();
    // The failed server action must surface an explicit recoverable error, not a receipt.
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Cobro registrado|Recibo no disponible/u })).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
  }

  // The lost request never reached the server: no payment exists after reconnecting.
  const offlineAttempt = await api.readOrder(seeded.orderId);
  expect(offlineAttempt.payments ?? []).toHaveLength(0);

  // A single retry after reconnecting charges the order exactly once.
  await page.reload();
  await assertAppPage(page, "/app/caja");
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();
  await payExactCash(page);

  const paid = await api.readOrder(seeded.orderId);
  expect(paid.status).toBe("paid");
  expect(paid.payments ?? []).toHaveLength(1);
  expect(paid.payments?.[0]?.amountMinor).toBe(seeded.totalMinor);

  // This run deliberately disconnects, so its expected network failures are not page defects: drop
  // them from the diagnostics instead of hiding any other error.
  for (const entries of [diag.failedRequests, diag.consoleErrors]) {
    const kept = entries.filter((entry) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/iu.test(entry));
    entries.splice(0, entries.length, ...kept);
  }
});
