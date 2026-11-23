import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { DATABASE_CLIENT, type DatabaseClientPort } from "./database.js";

type Request = IncomingMessage & { originalUrl: string; path: string; body?: unknown; query?: unknown };
type Response = ServerResponse & { json(value: unknown): Response; status(code: number): Response };
type NextFunction = () => void;

// Bounded above the default 100kb so a base64 catalog image (<=2 MB decoded, ~2.8 MB encoded) plus
// JSON overhead fits; still far below an unbounded body, and every route still re-validates its
// own payload shape/size on top of this transport-level ceiling.
export const JSON_BODY_SIZE_LIMIT = "3mb";

/** Configuration shared by every way of booting the API (main.ts, local smoke launcher, tests). */
export function configureApiApp(app: NestExpressApplication): void {
  let requests = 0;
  let errors = 0;
  let durationMs = 0;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = randomUUID();
    const started = performance.now();
    res.setHeader("x-correlation-id", correlationId);
    res.on("finish", () => {
      const latencyMs = performance.now() - started;
      requests += 1;
      if (res.statusCode >= 500) errors += 1;
      durationMs += latencyMs;
      const path = req.originalUrl.split("?")[0] ?? "";
      const scope: Record<string, string> = {};
      for (const [segment, key] of [["restaurants", "restaurantId"], ["branches", "branchId"], ["orders", "orderId"]] as const) {
        const match = new RegExp(`(?:^|/)${segment}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/|$)`, "i").exec(path);
        if (match?.[1] !== undefined) scope[key] = match[1];
        for (const source of [req.query, req.body]) {
          if (typeof source !== "object" || source === null) continue;
          const value = (source as Record<string, unknown>)[key];
          if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) scope[key] ??= value;
        }
      }
      console.info(JSON.stringify({ correlationId, ...scope, method: req.method, statusCode: res.statusCode, latencyMs }));
    });
    next();
  });
  app.use("/health", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path !== "/") return next();
    return res.json({ status: "ok" });
  });
  app.use("/ready", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path !== "/") return next();
    void app.get<DatabaseClientPort>(DATABASE_CLIENT).query("select 1", []).then(
      () => res.json({ status: "ready" }),
      () => res.status(503).json({ status: "unavailable" }),
    );
  });
  app.use("/metrics", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path !== "/") return next();
    return res.json({ requests, errors, latencyMsTotal: durationMs });
  });
  app.useBodyParser("json", { limit: JSON_BODY_SIZE_LIMIT });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
}
