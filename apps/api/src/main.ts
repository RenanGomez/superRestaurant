import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";
import { readApiConfig } from "./config.js";

// Bounded above the default 100kb so a base64 catalog image (<=2 MB decoded, ~2.8 MB encoded) plus
// JSON overhead fits; still far below an unbounded body, and every route still re-validates its
// own payload shape/size on top of this transport-level ceiling.
const JSON_BODY_SIZE_LIMIT = "3mb";

async function bootstrap(): Promise<void> {
  const config = readApiConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useBodyParser("json", { limit: JSON_BODY_SIZE_LIMIT });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  await app.listen(config.port);
}

await bootstrap();
