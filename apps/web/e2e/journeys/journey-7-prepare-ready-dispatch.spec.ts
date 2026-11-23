import {
  assertAppPage, beforeJourney, expect, openOrderDetail, requireActiveShift, requireOrderSeed, test,
} from "../fixtures/journey-test.ts";

test("journey 7: preparar, marcar lista y asignar/despachar reparto", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);
  await requireOrderSeed(api);
  await requireActiveShift(api);

  // A delivery-channel Order so the same run drives the kitchen transitions and the delivery board.
  const seeded = await api.seedOrder({ channel: "delivery" });
  // Registered before any UI action: a failed run first releases a delivery it may have dispatched,
  // then cancels the Order only while it still has no money captured.
  cleanup.add("liberar la orden del journey 7", async () => {
    await api.failActiveDelivery(seeded.orderId);
    await api.cancelIfUnpaid(seeded.orderId);
  });

  // 1. Kitchen side: send the line, then move it through preparing and ready from the order detail.
  const panel = await openOrderDetail(page, seeded.orderId);
  await expect(panel).toContainText(seeded.productName);
  await panel.getByRole("button", { name: "Enviar a cocina", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Enviadas" })).toBeVisible({ timeout: 25_000 });

  await panel.getByRole("button", { name: "Marcar en preparación", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "En preparación" })).toBeVisible({ timeout: 25_000 });

  await panel.getByRole("button", { name: "Marcar lista", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Listas" })).toBeVisible({ timeout: 25_000 });

  // 2. Dispatch side: the run's own card in «Por asignar» is located by its orderId, never by position.
  const couriers = await api.listCouriers();
  await page.goto("/app/deliveries");
  await assertAppPage(page, "/app/deliveries");
  if (await page.getByRole("heading", { name: "Por asignar" }).count() === 0) {
    test.skip(true, "La cuenta guardada no administra entregas; el journey 7 necesita un rol con deliveries.manage");
    throw new Error("Sin permiso de entregas");
  }
  const card = page.locator("article", { has: page.locator(`input[name="orderId"][value="${seeded.orderId}"]`) }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });

  if (couriers.length === 0) {
    // Deterministic branch for a branch with no active courier: the board states the gap instead of
    // offering an assignment that the server would reject. Precondition documented in the annotation.
    testInfo.annotations.push({
      type: "precondicion",
      description: "Sin repartidores activos: se verificaron preparación y listo; la asignación corre cuando exista un rol courier",
    });
    await expect(card.getByText("No hay repartidores activos; asigna el rol en Accesos.")).toBeVisible();
    return;
  }

  const assignForm = card.locator("form", { has: page.locator('input[name="courierUserId"]') }).first();
  await expect(assignForm).toBeVisible();
  await assignForm.getByRole("button").click();
  await expect(page.getByText("Repartidor asignado.", { exact: false })).toBeVisible({ timeout: 25_000 });

  // 3. Dispatch the run's assigned delivery: after the redirect the card lives in «En ruta».
  const assigned = page.locator("article", { has: page.locator(`input[name="orderId"][value="${seeded.orderId}"]`) }).first();
  await expect(assigned).toBeVisible({ timeout: 25_000 });
  await assigned.getByRole("button", { name: "Salió", exact: true }).click();
  await expect(page.getByText("Salida registrada.", { exact: false })).toBeVisible({ timeout: 25_000 });

  const delivery = (await api.listDeliveries()).items.find((item) => item.delivery.orderId === seeded.orderId);
  expect(delivery?.delivery.state).toBe("en_route");
});
