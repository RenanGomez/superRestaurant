import { assertAppPage, beforeJourney, expect, requireOrderSeed, test } from "../fixtures/journey-test.ts";
import { journeyBaseUrl } from "../fixtures/journey-env.ts";

test("journey 6: confirmar precio, pago en caja y envío a estación", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);

  const activeShift = (await api.listActiveShifts()).shifts.find((shift) => shift.status === "open");
  if (activeShift === undefined) {
    test.skip(true, "No hay turno operativo abierto para confirmar la orden");
    throw new Error("No hay turno operativo abierto");
  }

  // Deterministic seed built through the Order endpoints, without touching the published catalog.
  const seeded = await api.seedOrder();
  cleanup.add("cancelar la orden del journey 6 si quedó sin cobrar", () => api.cancelIfUnpaid(seeded.orderId));

  const register = await api.openRegister(activeShift.shiftId, 0);
  cleanup.add("cerrar la caja del journey 6", () => api.closeRegister(register));
  const baseUrl = journeyBaseUrl();
  await page.context().addCookies([
    { name: "sr-register-id", value: register.registerId, url: baseUrl },
    { name: "sr-device-id", value: register.deviceId, url: baseUrl },
    { name: "sr-cash-session-id", value: register.cashRegisterSessionId, url: baseUrl },
  ]);

  // 1. The order detail shows the server-priced total.
  await page.goto(`/app/orders?orderId=${encodeURIComponent(seeded.orderId)}`);
  await assertAppPage(page, "/app/orders");
  const panel = page.getByRole("region", { name: "Detalle de la orden" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toContainText(seeded.productName);
  await expect(panel).toContainText("Total:");
  await expect(panel).toContainText(/\$\s*\d/u);

  // 2. Send every line to its station from the order detail.
  await panel.getByRole("button", { name: "Enviar a cocina", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Enviadas" })).toBeVisible({ timeout: 25_000 });

  // 3. Collect the exact balance in the cash register.
  await expect(panel.getByRole("link", { name: "Cobrar en caja", exact: true })).toBeVisible();
  await page.goto(`/app/caja?orderId=${encodeURIComponent(seeded.orderId)}`);
  await assertAppPage(page, "/app/caja");
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();
  await expect(page.getByText("Saldo pendiente").first()).toBeVisible();

  await page.getByRole("button", { name: "Exacto" }).click();
  await expect(page.getByText(/Cambio después de propina/u)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cobrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Cobro registrado|Recibo no disponible/u })).toBeVisible({ timeout: 25_000 });

  const order = await api.readOrder(seeded.orderId);
  expect(order.status).toBe("paid");
});
