import {
  beforeJourney, expect, openOrderDetail, requireOrderSeed, test,
} from "../fixtures/journey-test.ts";

test("journey 8: aplicar descuento/cortesía con autorización", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);

  const seeded = await api.seedOrder();
  cleanup.add("cancelar la orden del journey 8 si quedó sin cobrar", () => api.cancelIfUnpaid(seeded.orderId));

  const panel = await openOrderDetail(page, seeded.orderId);
  await expect(panel).toContainText(seeded.productName);
  await expect(panel).toContainText("Total:");

  // The authorized discount/courtesy command (`orders.discount.apply`) is still being built in
  // `m1-cov-discounts-courtesies`; this spec owns the journey and activates the assertions the
  // moment the order detail and checkout expose the control. Until then it skips explicitly, never
  // pretending the journey was exercised or silently passing with no discount.
  const discountControl = panel.getByRole("button", { name: /descuento|cortes[ií]a/iu });
  if (await discountControl.count() === 0) {
    test.skip(true, "El flujo de descuento/cortesía con autorización aún no está implementado (m1-cov-discounts-courtesies); la spec se activa cuando exista el control y el permiso orders.discount.apply");
    throw new Error("Sin control de descuento/cortesía");
  }

  await discountControl.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Authorization is server-side: the operator supplies the reason and the supervisor credential
  // the backend validates; the client never decides that the discount was approved.
  await dialog.getByLabel(/motivo/iu).fill(`Descuento E2E ${seeded.orderId.slice(0, 8)}`);
  await dialog.getByLabel(/autoriza/iu).fill("supervisor-e2e");
  await dialog.getByRole("button", { name: /aplicar|confirmar/iu }).click();

  await expect(page.getByText(/descuento aplicado|cortes[ií]a aplicada/iu)).toBeVisible({ timeout: 25_000 });
  const order = await api.readOrder(seeded.orderId);
  expect(order.totals.totalMinor).toBeLessThan(seeded.totalMinor);
});
