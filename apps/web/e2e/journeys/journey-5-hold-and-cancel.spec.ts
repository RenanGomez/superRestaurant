import {
  addWholePizza, beforeJourney, expect, newTrayIds, openCapture, recoverDraftRow, registerDraftSweep,
  requirePizzaCatalog, startDeliveryCapture, test, waitForNewDraft,
} from "../fixtures/journey-test.ts";
import { digitsFrom } from "../fixtures/journey-env.ts";

test("journey 5: guardar en espera, retomar y cancelar con motivo", async ({ page, api, cleanup, runId }, testInfo) => {
  beforeJourney(testInfo);
  await requirePizzaCatalog(api);

  const customer = await api.seedCustomer(runId, `6${digitsFrom(runId, 4)}`);
  const matches = (item: { readonly customer?: { readonly displayName: string } | null }): boolean =>
    item.customer?.displayName === customer.name;
  const before = await newTrayIds(api);
  registerDraftSweep(cleanup, api, before, matches, "journey 5");

  await openCapture(page);
  await startDeliveryCapture(page, customer.name);
  const draft = await waitForNewDraft(api, before, matches);

  const note = `Espera ${runId}`;
  await addWholePizza(page, note);

  await page.getByRole("button", { name: /^Guardar para después/ }).click();
  await expect(page.getByText("Captura guardada para después.")).toBeVisible();

  // The held draft is recovered by this run's customer name, never by "the first Recoger row":
  // the row is unique to the run and cannot belong to another operator's draft.
  await recoverDraftRow(page, new RegExp(customer.name));
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
