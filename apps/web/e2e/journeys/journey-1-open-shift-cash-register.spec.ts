import { expect, test, beforeJourney, openCaja } from "../fixtures/journey-test.ts";
import { journeyBaseUrl } from "../fixtures/journey-env.ts";

const REGISTER_COOKIE = "sr-register-id";
const SESSION_COOKIE = "sr-cash-session-id";
const DEVICE_COOKIE = "sr-device-id";

test("journey 1: abrir turno y caja", async ({ page, api, cleanup }, testInfo) => {
  beforeJourney(testInfo);

  const catalog = (await api.menuCatalog()).catalog;
  const activeShift = (await api.listActiveShifts()).shifts.find((shift) => shift.status === "open");
  if (catalog === null || activeShift === undefined) {
    test.skip(true, "Falta catálogo publicado o turno operativo abierto para abrir la caja");
    throw new Error("Precondiciones de caja incompletas");
  }

  await openCaja(page);
  if (await page.getByText("Sin permiso de caja").first().isVisible().catch(() => false)) {
    test.skip(true, "La cuenta guardada no puede operar caja");
    throw new Error("Sin permiso de caja");
  }
  await expect(page.getByRole("heading", { name: "Abre la caja para cobrar" })).toBeVisible();

  // Registered before the opening form is submitted: if the test fails halfway, teardown still
  // reads whatever cookies the opening produced and closes that register.
  cleanup.add("cerrar la caja del journey 1", async () => {
    const cookies = await page.context().cookies(journeyBaseUrl());
    const value = (name: string): string | undefined => cookies.find((cookie) => cookie.name === name)?.value;
    const registerId = value(REGISTER_COOKIE);
    const cashRegisterSessionId = value(SESSION_COOKIE);
    const deviceId = value(DEVICE_COOKIE);
    if (registerId === undefined || cashRegisterSessionId === undefined || deviceId === undefined) return;
    await api.closeRegister({ cashRegisterSessionId, deviceId, registerId, shiftId: activeShift.shiftId });
  });

  await page.getByRole("textbox", { name: "Fondo inicial" }).fill("100.00");
  await page.getByRole("button", { name: "Abrir caja" }).click();

  await expect(page.getByText("Caja abierta y lista para cobrar.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Órdenes por cobrar" })).toBeVisible();
  await expect(page.getByText("Caja abierta", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Ver corte de caja" }).click();
  await expect(page.getByRole("heading", { name: /Corte X/ })).toBeVisible();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible();
  await expect(page.getByText("Fondo inicial").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cerrar caja" })).toBeVisible();
});
