import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  MENU_IMAGE_MAX_DECODED_BYTES,
  type MenuImageUploadResultV1,
  parseUploadMenuImageCommandV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import {
  buildCatalogImagePublicUrl,
  CATALOG_IMAGE_STORAGE_CONFIG,
  CATALOG_IMAGE_STORAGE_PORT,
  type CatalogImageStorageConfig,
  type CatalogImageStoragePort,
} from "./catalog-image-storage.js";

export type MenuCatalogImageApplicationErrorCode = "authorization" | "request" | "unavailable";

export class MenuCatalogImageApplicationError extends Error {
  public constructor(public readonly code: MenuCatalogImageApplicationErrorCode) {
    super(`MENU_CATALOG_IMAGE_${code.toUpperCase()}`);
    this.name = "MenuCatalogImageApplicationError";
  }
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

@Injectable()
export class MenuCatalogImageService {
  public constructor(
    @Inject(MembershipAuthorizationService) private readonly authorization: MembershipAuthorizationService,
    @Inject(CATALOG_IMAGE_STORAGE_PORT) private readonly storage: CatalogImageStoragePort,
    @Inject(CATALOG_IMAGE_STORAGE_CONFIG) private readonly config: CatalogImageStorageConfig,
  ) {}

  public async upload(principal: AuthenticatedPrincipal, input: unknown): Promise<MenuImageUploadResultV1> {
    const command = parseUploadMenuImageCommandV1(input);
    if (command === undefined) throw new MenuCatalogImageApplicationError("request");

    try {
      await this.authorization.authorizeBranch(principal, command.scope, "catalog.manage");
    } catch {
      throw new MenuCatalogImageApplicationError("authorization");
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(command.dataBase64, "base64");
    } catch {
      throw new MenuCatalogImageApplicationError("request");
    }
    if (
      bytes.length === 0
      || bytes.length > MENU_IMAGE_MAX_DECODED_BYTES
      || !matchesMagicBytes(bytes, command.contentType)
    ) throw new MenuCatalogImageApplicationError("request");

    const extension = EXTENSION_BY_CONTENT_TYPE[command.contentType];
    if (extension === undefined) throw new MenuCatalogImageApplicationError("request");
    const segment = command.target === "product" ? "products" : "options";
    const path = `${command.scope.restaurantId}/${segment}/${command.targetId}/${randomUUID().replaceAll("-", "")}.${extension}`;

    try {
      await this.storage.put(path, bytes, command.contentType);
    } catch {
      throw new MenuCatalogImageApplicationError("unavailable");
    }

    return Object.freeze({
      imagePath: path,
      publicUrl: buildCatalogImagePublicUrl(this.config, path),
      schemaVersion: 1 as const,
    });
  }
}

function matchesMagicBytes(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}
