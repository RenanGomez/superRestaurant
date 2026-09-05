import { AppState } from "react-native";

import { toMobileAppStatus, type MobileLifecyclePort } from "../lifecycle.js";

/**
 * The runtime lifecycle source: React Native's `AppState`. Everything that
 * decides *what to do* with a transition lives in `src/lifecycle.ts`, which has
 * no React Native dependency and is tested directly.
 */
export function createAppStateLifecycle(): MobileLifecyclePort {
  return Object.freeze({
    subscribe: (handler: (status: ReturnType<typeof toMobileAppStatus>) => void): (() => void) => {
      const subscription = AppState.addEventListener("change", (next) => { handler(toMobileAppStatus(next)); });
      return (): void => { subscription.remove(); };
    },
  });
}
