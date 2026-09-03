import { defineConfig } from "vite";

import { readLocalProxyTarget } from "./src/kds-proxy-target.js";

const proxyTarget = readLocalProxyTarget(process.env.KDS_PROXY_TARGET);

export default defineConfig({
  build: { sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    proxy: {
      "/api": { target: proxyTarget },
      "/socket.io": { target: proxyTarget, ws: true },
    },
  },
});
