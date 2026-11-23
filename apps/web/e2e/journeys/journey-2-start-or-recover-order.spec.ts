import {
  beforeJourney, expect, newTrayIds, openCapture, recoverDraftRow, startDeliveryCapture, test, waitForNewDraft,
} from "../fixtures/journey-test.ts";
import { digitsFrom } from "../fixtures/journey-env.ts";

test("journey 2: iniciar y recuperar una orden de teléfono a domicilio", async ({ page, api, cleanup, runId }, testInfo) => {
  beforeJourney(testInfo);

  const postalCode = `8${digitsFrom(runId, 4)}`;
  const customer = await api.seedCustomer(runId, postalCode);
  const before = await newTrayIds(api);

  await openCapture(page);
  await startDeliveryCapture(page, customer.name);

  const draft = await waitForNewDraft(api, before, (item) => item.customer?.displayName === customer.name);
  cleanup.add("cancelar el borrador del journey 2", () => api.closeDraft(draft.captureDraftId));

  await expect(page.getByTestId("rehydrated-customer-snapshot")).toContainText(customer.name);
  await expect(page.getByTestId("capture-customer-card")).toContainText(customer.phone);
  await expect(page.getByLabel("Origen", { exact: true })).toHaveValue("phone");
  await expect(page.getByLabel("Cumplimiento", { exact: true })).toHaveValue("delivery");

  // Recover the same draft after a full page reload: it must come back from the server tray,
  // not from local component state.
  await openCapture(page);
  await recoverDraftRow(page, new RegExp(customer.name));
  await expect(page.getByTestId("rehydrated-customer-snapshot")).toContainText(customer.name);
  await expect(page.getByLabel("Cumplimiento", { exact: true })).toHaveValue("delivery");
});
