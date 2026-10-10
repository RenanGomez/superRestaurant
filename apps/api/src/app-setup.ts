import type { NestExpressApplication } from "@nestjs/platform-express";

// Bounded above the default 100kb so a base64 catalog image (<=2 MB decoded, ~2.8 MB encoded) plus
// JSON overhead fits; still far below an unbounded body, and every route still re-validates its
// own payload shape/size on top of this transport-level ceiling.
export const JSON_BODY_SIZE_LIMIT = "3mb";

/** Configuration shared by every way of booting the API (main.ts, local smoke launcher, tests). */
export function configureApiApp(app: NestExpressApplication): void {
  app.useBodyParser("json", { limit: JSON_BODY_SIZE_LIMIT });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
}
