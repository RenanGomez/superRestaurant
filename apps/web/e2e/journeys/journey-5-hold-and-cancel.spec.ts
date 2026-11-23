import {
  addWholePizza, beforeJourney, expect, newTrayIds, openCapture, startPickupCapture, test, waitForNewDraft,
} from "../fixtures/journey-test.ts";

test("journey 5: guardar en espera, retomar y cancelar con motivo", async ({ page, api, cleanup, runId }, testInfo) => {
  beforeJourney(testInfo);

  const pickupName = `E2E Recoger ${runId}`;
  const before = await newTrayIds(api);
  await openCapture(page);
  await startPickupCapture(page, pickupName);

  const draft = await waitForNewDraft(api, before, (item) => item.fulfillmentChannel === "pickup");
  cleanup.add("cerrar el borrador del journey 5 si quedó abierto", () => api.closeDraft(draft.captureDraftId));

  const note = `Espera ${runId}`;
  await addWholePizza(page, note);

  await page.getByRole("button", { name: /^Guardar para después/ }).click();
  await expect(page.getByText("Captura guardada para después.")).toBeVisible();

  // The held draft must be recoverable from the server tray; the most recent "Recoger" row is ours.
  const tray = page.locator("section").filter({ has: page.getByRole("heading", { name: "Borradores recuperables" }) });
  const row = tray.getByRole("button").filter({ hasText: "Recoger" }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText("Borrador abierto.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Resumen del pedido")).toContainText(`Nota: ${note}`);

  await page.getByLabel("Resumen del pedido").getByRole("button", { name: /^Cancelar/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Motivo obligatorio", { exact: true }).fill(`Cancelación E2E ${runId}`);
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText("Captura cancelada.")).toBeVisible();

  const trayAfter = await api.listTray();
  expect(trayAfter.items.some((item) => item.captureDraftId === draft.captureDraftId)).toBe(false);
});
