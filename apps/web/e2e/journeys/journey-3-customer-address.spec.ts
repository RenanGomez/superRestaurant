import {
  beforeJourney, expect, newTrayIds, openCapture, startDeliveryCapture, test, waitForNewDraft,
} from "../fixtures/journey-test.ts";
import { digitsFrom } from "../fixtures/journey-env.ts";

test("journey 3: cliente, teléfono, dirección y verificación de cobertura", async ({ page, api, cleanup, runId }, testInfo) => {
  beforeJourney(testInfo);

  // Unique postal code per run, so the branch has no configured zone for it and the coverage
  // answer is deterministic (the run never depends on zones created by other people).
  const postalCode = `9${digitsFrom(runId, 4)}`;
  const customer = await api.seedCustomer(runId, postalCode);
  const before = await newTrayIds(api);

  await openCapture(page);
  await startDeliveryCapture(page, customer.name);

  const draft = await waitForNewDraft(api, before, (item) => item.customer?.displayName === customer.name);
  cleanup.add("cancelar el borrador del journey 3", () => api.closeDraft(draft.captureDraftId));

  const card = page.getByTestId("capture-customer-card");
  await expect(card).toContainText(customer.name);
  await expect(card).toContainText(customer.phone);
  await expect(card).toContainText("Casa");
  await expect(card).toContainText("Validada para esta sucursal");

  await card.getByRole("button", { name: "Usar esta dirección" }).click();
  const coverage = card.getByRole("alert");
  await expect(coverage).toContainText("no está en ninguna zona de la sucursal", { timeout: 20_000 });
  await expect(coverage).toContainText("cuota manual");
  await expect(page.getByText(/Falta guardar una dirección validada/u)).toBeVisible();
});
