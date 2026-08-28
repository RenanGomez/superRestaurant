import js from "@eslint/js";
import tseslint from "typescript-eslint";

const domainRestrictedImports = [
  {
    group: ["@nestjs/*", "nestjs"],
    message: "packages/domain must not import NestJS.",
  },
  {
    group: ["@prisma/*", "prisma"],
    message: "packages/domain must not import Prisma.",
  },
  {
    group: ["@supabase/*"],
    message: "packages/domain must not import Supabase SDKs.",
  },
  {
    group: ["react", "react/*", "react-dom", "react-dom/*"],
    message: "packages/domain must not import React.",
  },
  {
    group: [
      "node:child_process",
      "node:cluster",
      "node:dgram",
      "node:dns",
      "node:fs",
      "node:fs/*",
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
      "node:worker_threads",
    ],
    message: "packages/domain must remain free of Node network and storage modules.",
  },
  {
    group: [
      "@aws-sdk/*",
      "@react-native-async-storage/*",
      "aws-sdk",
      "axios",
      "better-sqlite3",
      "dexie",
      "fetch",
      "got",
      "ioredis",
      "ky",
      "localforage",
      "mongodb",
      "mysql2",
      "pg",
      "redis",
      "sqlite3",
      "undici",
    ],
    message: "packages/domain must remain free of network and storage clients.",
  },
];

export const baseConfig = [
  {
    ignores: [
      "**/.codegraph/**",
      "**/.pnpm-store/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.test-dist/**",
    ],
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    ...js.configs.recommended,
  },
  ...tseslint.configs.recommended,
  {
    files: ["packages/domain/src/**/*.{ts,cts,mts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: domainRestrictedImports }],
    },
  },
];
