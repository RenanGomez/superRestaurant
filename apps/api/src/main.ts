import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { configureApiApp } from "./app-setup.js";
import { AppModule } from "./app.module.js";
import { readApiConfig } from "./config.js";

async function bootstrap(): Promise<void> {
  const config = readApiConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApiApp(app);
  await app.listen(config.port);
}

await bootstrap();
