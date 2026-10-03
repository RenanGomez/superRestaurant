import { Inject, Injectable } from "@nestjs/common";

export const CATALOG_IMAGE_STORAGE_PORT = Symbol("CATALOG_IMAGE_STORAGE_PORT");
export const CATALOG_IMAGE_STORAGE_CONFIG = Symbol("CATALOG_IMAGE_STORAGE_CONFIG");

export const CATALOG_IMAGES_BUCKET = "catalog-images";

/** "exists" means an object already lives at that path (a replayed upload); it is not an error. */
export type CatalogImagePutResult = "created" | "exists";

export interface CatalogImageStoragePort {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<CatalogImagePutResult>;
}

/** Resolves the Storage configuration on first use so the API always boots without it. */
export interface CatalogImageStorageConfigSource {
  get(): CatalogImageStorageConfig;
}

export function lazyCatalogImageStorageConfig(environment: NodeJS.ProcessEnv): CatalogImageStorageConfigSource {
  let cached: CatalogImageStorageConfig | undefined;
  return {
    get: () => {
      cached ??= readCatalogImageStorageConfig(environment);
      return cached;
    },
  };
}

export interface CatalogImageStorageConfig {
  readonly publicBaseUrl: string;
  readonly secretKey: string;
  readonly supabaseUrl: string;
}

export class CatalogImageStorageConfigurationError extends Error {
  public constructor() {
    super("CATALOG_IMAGE_STORAGE_CONFIGURATION_REJECTED");
    this.name = "CatalogImageStorageConfigurationError";
  }
}

export function readCatalogImageStorageConfig(environment: NodeJS.ProcessEnv): CatalogImageStorageConfig {
  const rawUrl = boundedValue(environment.SUPABASE_URL, 2_048);
  const secretKey = boundedValue(environment.SUPABASE_SECRET_KEY, 2_048);
  if (rawUrl === undefined || secretKey === undefined) throw new CatalogImageStorageConfigurationError();
  if (!secretKey.startsWith("sb_secret_") || secretKey.length <= "sb_secret_".length || !/^[A-Za-z0-9_-]+$/u.test(secretKey)) {
    throw new CatalogImageStorageConfigurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new CatalogImageStorageConfigurationError();
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.hash !== ""
    || parsed.search !== ""
    || parsed.pathname !== "/"
  ) throw new CatalogImageStorageConfigurationError();

  const supabaseUrl = parsed.toString().replace(/\/$/u, "");
  return Object.freeze({ publicBaseUrl: supabaseUrl, secretKey, supabaseUrl });
}

function boundedValue(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > maxLength ? undefined : trimmed;
}

export class CatalogImageStorageUnavailableError extends Error {
  public constructor() {
    super("CATALOG_IMAGE_STORAGE_UNAVAILABLE");
    this.name = "CatalogImageStorageUnavailableError";
  }
}

/**
 * Uploads to Supabase Storage over plain `fetch` using the service-role secret key; this is the
 * only writer of the `catalog-images` bucket (ADR-011). `x-upsert: false` rejects overwriting an
 * existing object at the same path, which cannot legitimately happen because every path ends in a
 * freshly generated UUID.
 */
@Injectable()
export class FetchCatalogImageStorageAdapter implements CatalogImageStoragePort {
  public constructor(
    @Inject(CATALOG_IMAGE_STORAGE_CONFIG) private readonly configSource: CatalogImageStorageConfigSource,
  ) {}

  public async put(path: string, bytes: Uint8Array, contentType: string): Promise<CatalogImagePutResult> {
    const config = this.configSource.get();
    let response: Response;
    try {
      response = await fetch(
        `${config.supabaseUrl}/storage/v1/object/${CATALOG_IMAGES_BUCKET}/${path}`,
        {
          body: bytes,
          headers: {
            authorization: `Bearer ${config.secretKey}`,
            "content-type": contentType,
            "x-upsert": "false",
          },
          method: "POST",
        },
      );
    } catch {
      throw new CatalogImageStorageUnavailableError();
    }
    if (response.ok) return "created";
    if (await isDuplicate(response)) return "exists";
    throw new CatalogImageStorageUnavailableError();
  }
}

/** Storage reports an existing object as 409, or as 400 with a JSON body carrying statusCode 409. */
async function isDuplicate(response: Response): Promise<boolean> {
  if (response.status === 409) return true;
  if (response.status !== 400) return false;
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "statusCode" in body && String(body.statusCode) === "409";
  } catch {
    return false;
  }
}

export function buildCatalogImagePublicUrl(config: CatalogImageStorageConfig, path: string): string {
  return `${config.publicBaseUrl}/storage/v1/object/public/${CATALOG_IMAGES_BUCKET}/${path}`;
}
