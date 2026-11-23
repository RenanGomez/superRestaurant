"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { uiButton } from "../lib/ui-classes";

const SW_URL = "/sw.js";
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;
const SCHEMA_UPDATE_EVENT = "sr:schema-update-available";

type UpdateReason = "sw" | "schema";

interface SwMessagePayload {
  readonly type?: unknown;
}

function isSchemaUpdateMessage(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const payload = data as SwMessagePayload;
  return payload.type === "SCHEMA_UPDATE_AVAILABLE" || payload.type === "PWA_SCHEMA_OR_VERSION_UPDATE";
}

/**
 * Registers the static-only PWA Service Worker and displays a non-blocking,
 * accessible in-app banner when a newer Service Worker or local schema version
 * is waiting to be applied. Never uses alert(), confirm(), or prompt(), and
 * never interrupts an active POS operation with an unprompted reload.
 */
export function PwaRegister(): ReactNode {
  const [updateReason, setUpdateReason] = useState<UpdateReason | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadingRef = useRef(false);
  const lastCheckAtRef = useRef(0);

  const revealUpdate = useCallback((reason: UpdateReason): void => {
    setUpdateReason((current) => (current === "schema" ? "schema" : reason));
    setDismissed(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    let trackedRegistration: ServiceWorkerRegistration | null = null;
    let trackedInstalling: ServiceWorker | null = null;

    const handleInstallingStateChange = (): void => {
      if (cancelled || trackedInstalling === null) return;
      if (trackedInstalling.state === "installed" && navigator.serviceWorker.controller !== null) {
        revealUpdate("sw");
      }
    };

    const handleUpdateFound = (): void => {
      if (cancelled || trackedRegistration === null) return;
      const installing = trackedRegistration.installing;
      if (installing === null) return;
      if (trackedInstalling !== null) {
        trackedInstalling.removeEventListener("statechange", handleInstallingStateChange);
      }
      trackedInstalling = installing;
      trackedInstalling.addEventListener("statechange", handleInstallingStateChange);
    };

    const handleControllerChange = (): void => {
      if (reloadingRef.current) {
        window.location.reload();
      }
    };

    const handleServiceWorkerMessage = (event: MessageEvent): void => {
      if (isSchemaUpdateMessage(event.data)) {
        revealUpdate("schema");
      }
    };

    const handleSchemaEvent = (): void => {
      revealUpdate("schema");
    };

    const checkForUpdates = (): void => {
      const registration = registrationRef.current;
      if (registration === null) return;
      const now = Date.now();
      if (now - lastCheckAtRef.current < UPDATE_CHECK_THROTTLE_MS) return;
      lastCheckAtRef.current = now;
      void registration.update().catch(() => {
        // Offline or transient network error during background update check; ignore silently.
      });
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        checkForUpdates();
      }
    };

    const handleOnline = (): void => {
      lastCheckAtRef.current = 0;
      checkForUpdates();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    window.addEventListener(SCHEMA_UPDATE_EVENT, handleSchemaEvent);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    void navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        trackedRegistration = registration;
        registrationRef.current = registration;
        lastCheckAtRef.current = Date.now();

        if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
          revealUpdate("sw");
        }

        registration.addEventListener("updatefound", handleUpdateFound);
      })
      .catch(() => {
        // Registration can fail in unsupported or restricted private browsing contexts.
      });

    return () => {
      cancelled = true;
      if (trackedInstalling !== null) {
        trackedInstalling.removeEventListener("statechange", handleInstallingStateChange);
      }
      if (trackedRegistration !== null) {
        trackedRegistration.removeEventListener("updatefound", handleUpdateFound);
      }
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      window.removeEventListener(SCHEMA_UPDATE_EVENT, handleSchemaEvent);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [revealUpdate]);

  const handleApplyUpdate = (): void => {
    if (isApplying) return;
    setIsApplying(true);
    reloadingRef.current = true;

    const waiting = registrationRef.current?.waiting ?? null;
    if (waiting !== null) {
      waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    window.location.reload();
  };

  const handleDismiss = (): void => {
    setDismissed(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape" && !isApplying) {
      event.stopPropagation();
      setDismissed(true);
    }
  };

  if (updateReason === null || dismissed) {
    return null;
  }

  const description = updateReason === "schema"
    ? "Hay una actualización del esquema y de la aplicación. Recarga al terminar tu operación actual para aplicar los cambios."
    : "Hay una nueva versión de superRestaurant lista. Recarga cuando termines tu operación actual.";

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Actualización disponible"
      onKeyDown={handleKeyDown}
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 rounded-xl border border-border bg-surface p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-full sm:max-w-md"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-heading text-sm font-bold text-text">Nueva versión disponible</p>
          <p className="text-xs leading-relaxed text-text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={isApplying}
            onClick={handleDismiss}
            className={uiButton("secondary", "min-w-11")}
          >
            Más tarde
          </button>
          <button
            type="button"
            disabled={isApplying}
            onClick={handleApplyUpdate}
            className={uiButton("primary", "min-w-11")}
          >
            {isApplying ? "Actualizando…" : "Actualizar ahora"}
          </button>
        </div>
      </div>
    </aside>
  );
}
