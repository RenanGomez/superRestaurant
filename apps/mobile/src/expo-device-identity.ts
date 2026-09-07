/**
 * The Expo adapter for `src/device-identity.ts`, and the only file that imports
 * the two native modules. Keeping it apart is what lets the identity rules run
 * in the pure test build, and what keeps `expo-secure-store` out of every module
 * that merely needs a `deviceId`.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is deliberate: the identity describes *this*
 * installation, so it must never travel to another device through an iCloud
 * keychain backup, and it is not needed while the device is locked.
 */
import { randomUUID } from "expo-crypto";
import { getItemAsync, isAvailableAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";

import {
  createMobileDeviceIdentity,
  type MobileDeviceIdentity,
  type MobileSecureStorePort,
} from "./device-identity.js";

const OPTIONS = Object.freeze({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });

export const expoSecureStore: MobileSecureStorePort = Object.freeze({
  getItem: (key: string): Promise<string | null> => getItemAsync(key, OPTIONS),
  isAvailable: (): Promise<boolean> => isAvailableAsync(),
  setItem: (key: string, value: string): Promise<void> => setItemAsync(key, value, OPTIONS),
});

export function createExpoDeviceIdentity(): MobileDeviceIdentity {
  return createMobileDeviceIdentity({ randomUuid: randomUUID, store: expoSecureStore });
}

/** The platform's CSPRNG, as the one generator the order plan may use. */
export const expoRandomUuid = (): string => randomUUID();
