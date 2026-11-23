import { expect, test, beforeJourney, openCaja } from "../fixtures/journey-test.ts";

const REGISTER_COOKIE = "sr-register-id";
const SESSION_COOKIE = "sr-cash-session-id";
const DEVICE_COOKIE = "sr-device-id";

test("journey 1: abrir turno y caja", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);

  await openCaja(page);
  await expect(page.getByRole("heading", { name: "Abre la caja para cobrar" })).toBeVisible();

  await page.getByRole("textbox", { name: "Fondo inicial" }).fill("100.00");
  await page.getByRole("button", { name: "Abrir caja" }).click();

  await expect(page.getByText("Caja abierta y lista para cobrar.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Órdenes por cobrar" })).toBeVisible();
  await expect(page.getByText("Caja abierta", { exact: true })).toBeVisible();

  const cookies = await page.context().cookies("http://localhost:8082");
  const value = (name: string): string => {
    const cookie = cookies.find((candidate) => candidate.name === name);
    if (cookie === undefined) throw new Error(`La caja no emitió la cookie ${name}`);
    return cookie.value;
  };
  cleanup.add("cerrar la caja del journey 1", () => api.closeRegister({
    cashRegisterSessionId: value(SESSION_COOKIE),
    deviceId: value(DEVICE_COOKIE),
    registerId: value(REGISTER_COOKIE),
    shiftId: "00000000-0000-4000-8000-000000000000",
  }));

  await page.getByRole("link", { name: "Ver corte de caja" }).click();
  await expect(page.getByRole("heading", { name: /Corte X/ })).toBeVisible();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible();
  await expect(page.getByText("Fondo inicial").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cerrar caja" })).toBeVisible();
});
