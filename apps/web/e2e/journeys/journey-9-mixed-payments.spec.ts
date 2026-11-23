import {
  assertAppPage, beforeJourney, expect, openRegisterForRun, payExactCash, pesosInput, requireActiveShift,
  requireOrderSeed, test,
} from "../fixtures/journey-test.ts";

test("journey 9: pagos mixtos sin duplicados", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);
  const shiftId = await requireActiveShift(api);

  const seeded = await api.seedOrder();
  expect(seeded.totalMinor).toBeGreaterThan(1);
  cleanup.add("cancelar la orden del journey 9 si quedó sin cobrar", () => api.cancelIfUnpaid(seeded.orderId));
  await openRegisterForRun(page, api, cleanup, shiftId, 0, "journey 9");

  // First partial payment: half of the server total, paid with an external card terminal.
  const firstMinor = Math.floor(seeded.totalMinor / 2);
  await page.goto(`/app/caja?orderId=${encodeURIComponent(seeded.orderId)}`);
  await assertAppPage(page, "/app/caja");
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();

  await page.getByRole("button", { name: "Dividir pago" }).click();
  await page.getByLabel("A cobrar en pesos").fill(pesosInput(firstMinor));
  await page.getByRole("button", { name: "Tarjeta externa" }).click();
  await page.getByLabel("Terminal", { exact: true }).fill("Terminal E2E");
  await page.getByLabel(/Referencia \(mínimo 6 caracteres\)/u).fill(`E2E${seeded.orderId.slice(0, 8)}`);
  await page.getByRole("button", { name: "Cobrar", exact: true }).click();

  await expect(page.getByRole("heading", { name: /Cobro registrado|Recibo no disponible/u })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Saldo restante/u)).toBeVisible();

  // Second payment: the exact remaining balance in cash finishes the mixed payment.
  await page.getByRole("link", { name: "Seguir cobrando esta cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();
  await payExactCash(page);

  // No duplicates: exactly the two captured payments, distinct ids and amounts that add up.
  const order = await api.readOrder(seeded.orderId);
  expect(order.status).toBe("paid");
  const payments = order.payments ?? [];
  expect(payments).toHaveLength(2);
  expect(new Set(payments.map((payment) => payment.paymentId)).size).toBe(2);
  expect(payments.reduce((sum, payment) => sum + payment.amountMinor, 0)).toBe(seeded.totalMinor);
  expect(payments.map((payment) => payment.method).sort()).toEqual(["card_manual", "cash"]);

  // A reload of the paid account must not create or show a third charge.
  await page.reload();
  await assertAppPage(page, "/app/caja");
  const afterReload = await api.readOrder(seeded.orderId);
  expect(afterReload.payments ?? []).toHaveLength(2);
});
