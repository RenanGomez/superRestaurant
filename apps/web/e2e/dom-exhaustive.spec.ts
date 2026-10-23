import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

import { attachDiagnostics, expectAuthenticated, hasNextErrorOverlay, isDestructive } from "./helpers.ts";
import { APP_ROUTES } from "./routes.ts";

const SELECTOR =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, input:not([type="hidden"]), select, textarea';
const MAX_ELEMENTS = Number(process.env.E2E_MAX_ELEMENTS ?? "150");

interface ElementRecord {
  route: string;
  index: number;
  tag: string;
  name: string;
  href: string | null;
  result: "clicked" | "filled" | "skipped" | "error";
  reason?: string;
  navigatedTo?: string;
  pageErrorsAfter: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fillValueFor(type: string): string {
  if (type === "number") return "1";
  if (type === "email") return "e2e@example.com";
  if (type === "date") return todayIso();
  return "prueba e2e";
}

async function describe(el: Locator): Promise<{ tag: string; name: string; href: string | null; type: string }> {
  return el.evaluate((node) => {
    const e = node as HTMLElement;
    const input = node as HTMLInputElement;
    const name =
      e.getAttribute("aria-label") ?? (e.innerText ?? "").trim() ?? "";
    return {
      tag: e.tagName.toLowerCase(),
      name: (name !== "" ? name : (input.name ?? "") || (input.placeholder ?? "")).replace(/\s+/g, " ").trim().slice(0, 60),
      href: e.getAttribute("href"),
      type: (input.type ?? "").toLowerCase(),
    };
  });
}

for (const route of APP_ROUTES) {
  test(`dom-exhaustive ${route.label} (${route.path})`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const diagnostics = attachDiagnostics(page, testInfo);
    await page.goto(route.path);
    expectAuthenticated(page, route.path);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const origin = new URL(baseURL ?? "http://localhost:8082").origin;
    const all = page.locator(SELECTOR);
    const found = await all.count();
    const total = Math.min(found, MAX_ELEMENTS);
    const records: ElementRecord[] = [];

    for (let i = 0; i < total; i += 1) {
      const el = page.locator(SELECTOR).nth(i);
      const record: ElementRecord = { route: route.path, index: i, tag: "?", name: "", href: null, result: "skipped", pageErrorsAfter: 0 };
      try {
        if (!(await el.isVisible()) || !(await el.isEnabled())) {
          record.reason = "no visible o deshabilitado";
        } else {
          const info = await describe(el);
          record.tag = info.tag;
          record.name = info.name;
          record.href = info.href;
          const externalHref = info.href !== null && /^(mailto:|tel:)/i.test(info.href);
          const otherOrigin = info.href !== null && /^https?:/i.test(info.href) && new URL(info.href).origin !== origin;
          if (isDestructive(info.name) || (info.href !== null && isDestructive(info.href))) {
            record.reason = "destructivo";
          } else if (externalHref || otherOrigin || (info.href?.includes("/logout") ?? false)) {
            record.reason = "href externo o logout";
          } else if (info.type === "file") {
            record.reason = "input file";
          } else if (info.tag === "input" || info.tag === "textarea") {
            if (info.type === "checkbox" || info.type === "radio") {
              await el.click({ timeout: 3_000, noWaitAfter: true });
              await el.click({ timeout: 3_000, noWaitAfter: true });
            } else if (info.type === "submit" || info.type === "button" || info.type === "reset" || info.type === "image") {
              record.reason = "botón de formulario";
            } else {
              const previous = await el.inputValue();
              await el.focus();
              await el.fill(fillValueFor(info.type));
              await el.fill(previous);
            }
            if (record.reason === undefined) record.result = "filled";
          } else if (info.tag === "select") {
            await el.focus();
            record.result = "filled";
          } else {
            const before = page.url();
            await el.click({ timeout: 3_000, noWaitAfter: true });
            await page.waitForTimeout(300);
            await page.keyboard.press("Escape");
            record.result = "clicked";
            if (page.url() !== before) {
              record.navigatedTo = page.url();
              await page.goto(route.path);
              await page.waitForLoadState("domcontentloaded");
            }
          }
        }
      } catch (error) {
        record.result = "error";
        record.reason = error instanceof Error ? error.message.split("\n")[0] ?? "error" : "error";
      }
      record.pageErrorsAfter = diagnostics.pageErrors.length;
      records.push(record);
    }

    const count = (r: ElementRecord["result"]) => records.filter((x) => x.result === r).length;
    console.log(
      `[dom] ${route.path}: encontrados=${found} pulsados=${count("clicked")} llenados=${count("filled")} saltados=${count("skipped")} errores=${count("error")}`,
    );

    const project = testInfo.project.name;
    const file = `e2e-report/dom-coverage-${project}.json`;
    mkdirSync("e2e-report", { recursive: true });
    const accumulated: Record<string, ElementRecord[]> = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, ElementRecord[]>) : {};
    accumulated[route.path] = records;
    writeFileSync(file, JSON.stringify(accumulated, null, 2));
    await testInfo.attach(`dom-coverage-${project}.json`, { body: JSON.stringify(records, null, 2), contentType: "application/json" });

    expect.soft(diagnostics.pageErrors, "pageerror").toEqual([]);
    expect.soft(diagnostics.serverErrors, "respuestas 5xx").toEqual([]);
    expect(await hasNextErrorOverlay(page), "overlay de error de Next").toBe(false);
  });
}
