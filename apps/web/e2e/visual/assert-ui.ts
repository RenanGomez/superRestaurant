import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import {
  assertVisualSnapshot,
  type VisualControl,
  type VisualSnapshot,
} from "../../src/lib/visual-assert.ts";

interface VisualTracker {
  readonly consoleErrors: string[];
  readonly networkFailures: string[];
  readonly dialogCalls: string[];
}

interface RawSnapshot {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scrollWidth: number;
  readonly controls: VisualControl[];
  readonly focusedOutline: string | null;
}

const CONTROL_SELECTOR =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

const trackers = new WeakMap<Page, VisualTracker>();
const CAPTURE_DIR = fileURLToPath(new URL("../../../../docs/agentic/visual-m2", import.meta.url));

/** Overrides the capture folder for one verification round (e.g. `docs/agentic/visual-verify-2026-11-26`). */
export function setVisualCaptureDir(relativeToWebApp: string): void {
  captureDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)), relativeToWebApp);
}

let captureDir = CAPTURE_DIR;

export function trackVisualUi(page: Page): VisualTracker {
  const existing = trackers.get(page);
  if (existing !== undefined) return existing;
  const tracker: VisualTracker = { consoleErrors: [], networkFailures: [], dialogCalls: [] };
  page.on("console", (message) => {
    if (message.type() === "error") tracker.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      tracker.networkFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (failure.includes("net::ERR_ABORTED") || failure.includes("ERR_INTERNET_DISCONNECTED")) return;
    tracker.networkFailures.push(`${request.method()} ${request.url()} ${failure}`);
  });
  page.on("dialog", (dialog) => {
    tracker.dialogCalls.push(dialog.type());
    void dialog.dismiss().catch(() => undefined);
  });
  trackers.set(page, tracker);
  return tracker;
}

async function readSnapshot(page: Page): Promise<RawSnapshot> {
  await page.keyboard.press("Tab").catch(() => undefined);
  return page.evaluate((selector) => {
    function accessibleName(element: Element): string {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel !== null && ariaLabel.trim() !== "") return ariaLabel.trim();
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy !== null) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text !== "") return text;
      }
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        const labels = Array.from(element.labels ?? [])
          .map((label) => label.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (labels !== "") return labels;
        if (
          element instanceof HTMLInputElement &&
          (element.type === "submit" || element.type === "button" || element.type === "reset")
        ) {
          return element.value.trim();
        }
        if (element instanceof HTMLInputElement && element.placeholder.trim() !== "") {
          return element.placeholder.trim();
        }
      }
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text !== "") return text;
      return (element.getAttribute("title") ?? "").trim();
    }

    const controls: VisualControl[] = [];
    for (const element of document.querySelectorAll(selector)) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0 &&
        element.getClientRects().length > 0;
      controls.push({
        name: accessibleName(element),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible,
      });
    }

    const active = document.activeElement;
    let focusedOutline: string | null = null;
    if (active !== null && active !== document.body && active !== document.documentElement) {
      const style = window.getComputedStyle(active);
      focusedOutline = `outline: ${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}; box-shadow: ${style.boxShadow}`;
    }

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      controls,
      focusedOutline,
    };
  }, CONTROL_SELECTOR);
}

export async function assertVisualUi(page: Page, label: string): Promise<void> {
  const tracker = trackVisualUi(page);
  const raw = await readSnapshot(page);
  const snapshot: VisualSnapshot = {
    viewportWidth: raw.viewportWidth,
    viewportHeight: raw.viewportHeight,
    scrollWidth: raw.scrollWidth,
    controls: raw.controls,
    consoleErrors: [...tracker.consoleErrors],
    networkFailures: [...tracker.networkFailures],
    dialogCalls: [...tracker.dialogCalls],
    focusedOutline: raw.focusedOutline,
  };
  mkdirSync(captureDir, { recursive: true });
  const screenshotPath = resolve(captureDir, `${label}-${snapshot.viewportWidth}.png`);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assertVisualSnapshot(snapshot);
}
