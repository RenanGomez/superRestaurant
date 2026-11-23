import {
  addHalfAndHalfPizza, beforeJourney, expect, newTrayIds, openCapture, registerDraftSweep,
  requirePizzaCatalog, startDeliveryCapture, test, waitForNewDraft,
} from "../fixtures/journey-test.ts";
import { digitsFrom } from "../fixtures/journey-env.ts";

test("journey 4: configurar producto, tamaño, mitades, ingredientes y nota", async ({ page, api, cleanup, runId }, testInfo) => {
  beforeJourney(testInfo);
  await requirePizzaCatalog(api);

  const customer = await api.seedCustomer(runId, `7${digitsFrom(runId, 4)}`);
  const matches = (item: { readonly customer?: { readonly displayName: string } | null }): boolean =>
    item.customer?.displayName === customer.name;
  const before = await newTrayIds(api);
  registerDraftSweep(cleanup, api, before, matches, "journey 4");

  await openCapture(page);
  await startDeliveryCapture(page, customer.name);
  await waitForNewDraft(api, before, matches);

  const note = `Mitad E2E ${runId}`;
  await addHalfAndHalfPizza(page, { note });

  const ticket = page.getByLabel("Resumen del pedido");
  await expect(ticket).toContainText("Mitad A: Salchicha");
  await expect(ticket).toContainText("Mitad B: Tocino");
  await expect(ticket).toContainText("Orilla de Queso");
  await expect(ticket).toContainText(`Nota: ${note}`);
  await expect(ticket).toContainText("Total de productos");
  await expect(ticket).toContainText(/\$\s*\d/u);

  await expect(page.getByRole("button", { name: /^Guardar para después/ })).toBeEnabled();
});
