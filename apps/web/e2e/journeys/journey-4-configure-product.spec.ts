import {
  addHalfAndHalfPizza, beforeJourney, expect, newTrayIds, openCapture, startCounterCapture, test, waitForNewDraft,
} from "../fixtures/journey-test.ts";

test("journey 4: configurar producto, tamaño, mitades, ingredientes y nota", async ({ page, api, cleanup, runId }, testInfo) => {
  beforeJourney(testInfo);

  const before = await newTrayIds(api);
  await openCapture(page);
  await startCounterCapture(page);

  const draft = await waitForNewDraft(api, before);
  cleanup.add("cancelar el borrador del journey 4", () => api.closeDraft(draft.captureDraftId));

  const note = `Mitad E2E ${runId}`;
  await addHalfAndHalfPizza(page, { note });

  const ticket = page.getByLabel("Resumen del pedido");
  await expect(ticket).toContainText("Mitad A: Salchicha");
  await expect(ticket).toContainText("Mitad B: Tocino");
  await expect(ticket).toContainText("Orilla de Queso");
  await expect(ticket).toContainText(`Nota: ${note}`);
  await expect(ticket).toContainText("Total de productos");
  await expect(ticket).toContainText(/\$\s*\d/u);

  // The server priced the configured line; reordering is not required for the journey.
  await expect(page.getByRole("button", { name: /^Guardar para después/ })).toBeEnabled();
});
