import {
  assertAppPage, beforeJourney, expect, openRegisterForRun, payExactCash, pesosInput, requireActiveShift,
  requireOrderSeed, test,
} from "../fixtures/journey-test.ts";

test("journey 11: cerrar caja y conciliar pedidos, cobros y efectivo", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);
  const shiftId = await requireActiveShift(api);

  const openingFloatMinor = 15_000;
  const seeded = await api.seedOrder();
  cleanup.add("cancelar la orden del journey 11 si quedó sin cobrar", () => api.cancelIfUnpaid(seeded.orderId));
  const register = await openRegisterForRun(page, api, cleanup, shiftId, openingFloatMinor, "journey 11");

  // 1. One cash sale against the open register.
  await page.goto(`/app/caja?orderId=${encodeURIComponent(seeded.orderId)}`);
  await assertAppPage(page, "/app/caja");
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();
  await payExactCash(page);

  const report = await api.readRegister(register);
  expect(report.register.status).toBe("open");
  expect(report.paymentCount).toBeGreaterThanOrEqual(1);
  expect(report.cashCapturedMinor).toBeGreaterThanOrEqual(seeded.totalMinor);
  expect(report.register.expectedCashBalanceMinor).toBe(
    report.register.openingFloatMinor + report.cashCapturedMinor + report.cashTipsMinor,
  );

  // 2. The operational cut reconciles the same numbers the server just reported.
  await page.goto("/app/caja/corte");
  await assertAppPage(page, "/app/caja/corte");
  await expect(page.getByRole("heading", { name: /Corte X/ })).toBeVisible();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible();
  await expect(page.getByText("Ventas en efectivo").first()).toBeVisible();
  await expect(page.getByText("Cobros").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cerrar caja" })).toBeVisible();

  // 3. Close with counted === expected: the difference must freeze at zero.
  const expected = report.register.expectedCashBalanceMinor;
  await page.getByLabel("Efectivo contado").fill(pesosInput(expected));
  await page.getByLabel(/Este cierre es definitivo/iu).check();
  await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
  await expect(page.getByText("Caja cerrada. El corte operativo quedó congelado.")).toBeVisible({ timeout: 25_000 });

  await expect(page.getByRole("heading", { name: /Corte Z/ })).toBeVisible();
  await expect(page.getByText("Contado").first()).toBeVisible();
  await expect(page.getByText("Diferencia").first()).toBeVisible();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible();

  const closed = await api.readRegister(register);
  expect(closed.register.status).toBe("closed");
  expect(closed.register.countedClosingBalanceMinor).toBe(expected);
  expect(closed.register.differenceMinor).toBe(0);
});
