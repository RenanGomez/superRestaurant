import {
  assertAppPage, beforeJourney, expect, openOrderDetail, openRegisterForRun, payExactCash, requireActiveShift,
  requireOrderSeed, test,
} from "../fixtures/journey-test.ts";

test("journey 10: imprimir comanda y ticket, cerrar la orden con historial íntegro", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);
  const shiftId = await requireActiveShift(api);

  const seeded = await api.seedOrder();
  cleanup.add("cancelar la orden del journey 10 si quedó sin cobrar", () => api.cancelIfUnpaid(seeded.orderId));
  await openRegisterForRun(page, api, cleanup, shiftId, 0, "journey 10");

  // 1. Print the kitchen command before the lines leave the pending state.
  const panel = await openOrderDetail(page, seeded.orderId);
  await expect(panel).toContainText(seeded.productName);
  await panel.getByRole("button", { name: "Imprimir comanda", exact: true }).click();
  const kitchenPreview = page.getByRole("dialog", { name: "Vista previa de impresión" });
  await expect(kitchenPreview).toBeVisible();
  await expect(kitchenPreview.getByRole("heading", { name: /^Comanda/u }).first()).toBeVisible();
  await kitchenPreview.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(kitchenPreview).toBeHidden();

  // 2. Send to the station, then close the account by collecting the exact cash balance.
  await panel.getByRole("button", { name: "Enviar a cocina", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Enviadas" })).toBeVisible({ timeout: 25_000 });

  await page.goto(`/app/caja?orderId=${encodeURIComponent(seeded.orderId)}`);
  await assertAppPage(page, "/app/caja");
  await expect(page.getByRole("heading", { name: "Cobrar cuenta" })).toBeVisible();
  await payExactCash(page);

  // 3. Print the customer ticket from the captured payment.
  await page.getByRole("button", { name: "Imprimir ticket", exact: true }).click();
  const ticketPreview = page.getByRole("dialog", { name: "Vista previa de impresión" });
  await expect(ticketPreview).toBeVisible();
  await expect(ticketPreview.getByRole("heading", { name: "Ticket de cliente", exact: true })).toBeVisible();
  await expect(ticketPreview).toContainText(seeded.productName);
  await ticketPreview.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(ticketPreview).toBeHidden();

  // 4. History: the closed order keeps its line, its status and its captured payment.
  const order = await api.readOrder(seeded.orderId);
  expect(order.status).toBe("paid");
  expect(order.items ?? []).toHaveLength(1);
  expect(order.items?.[0]?.name).toBe(seeded.productName);
  expect(order.items?.[0]?.status).toBe("sent");
  expect(order.payments ?? []).toHaveLength(1);
  expect(order.payments?.[0]?.amountMinor).toBe(seeded.totalMinor);

  // The detail panel still renders the historical line after the sale is closed.
  const closedPanel = await openOrderDetail(page, seeded.orderId);
  await expect(closedPanel).toContainText(seeded.productName);
  await expect(closedPanel).toContainText("Total:");
});
