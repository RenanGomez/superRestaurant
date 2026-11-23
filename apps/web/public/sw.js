/*
 * superRestaurant PWA Service Worker (static assets & public app shell only).
 *
 * Security invariants (AGENTS.md §11/§13, ADR-005):
 * - NEVER caches non-GET requests (POST/PUT/PATCH/DELETE, Server Actions).
 * - NEVER caches cross-origin requests, /api/*, /auth/*, RSC payloads, or
 *   responses carrying Cache-Control: private / no-store or Set-Cookie.
 * - NEVER caches authenticated /app/* HTML pages (tenant/PII isolation).
 * - Serves a static, zero-PII app shell when offline navigation fails.
 */

const SW_VERSION = "1.0.0";
const CACHE_PREFIX = "sr-pwa-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-v1`;
const STATIC_CACHE = `${CACHE_PREFIX}static-v1`;
const ALLOWED_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);
const OFFLINE_SHELL_KEY = "/__pwa_offline_shell__";

const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

const OFFLINE_SHELL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0076a8" />
  <title>superRestaurant · Sin conexión</title>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <style>
    :root {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #1a2332;
      --muted: #586578;
      --accent: #0076a8;
      --accent-hover: #005f88;
      --border: #dce2ea;
      --nav: #131b26;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .shell { min-height: 100vh; display: flex; flex-direction: column; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding: 12px 20px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; color: var(--text); text-decoration: none; }
    .brand img { width: 36px; height: 36px; border-radius: 10px; display: block; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); font-size: 13px; font-weight: 600; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: #c2410c; }
    .content { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
    .card { width: 100%; max-width: 460px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(19, 27, 38, 0.06); }
    h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; }
    p { margin: 0 0 16px; font-size: 14px; line-height: 1.55; color: var(--muted); }
    .status { margin: 0 0 20px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); font-size: 13px; color: var(--text); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 10px 18px; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid transparent; }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #ffffff; }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .btn-secondary { background: var(--surface); border-color: var(--border); color: var(--text); }
    .btn-secondary:hover { background: var(--bg); }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/app">
        <img src="/icons/icon.svg" alt="" width="36" height="36" />
        <span>superRestaurant</span>
      </a>
      <span class="badge" id="conn-badge"><span class="dot" aria-hidden="true"></span>Sin conexión</span>
    </header>
    <main class="content">
      <section class="card" aria-labelledby="offline-title">
        <h1 id="offline-title">Sin conexión a la red</h1>
        <p>La aplicación sigue instalada en este dispositivo. Por seguridad, las respuestas privadas del servidor no se almacenan en la caché del navegador.</p>
        <div class="status" id="offline-status" role="status" aria-live="polite">
          Reconecta la red y pulsa «Reintentar conexión» para continuar operando.
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="retry-btn">Reintentar conexión</button>
          <a class="btn btn-secondary" href="/login">Ir a inicio de sesión</a>
        </div>
      </section>
    </main>
  </div>
  <script>
    (function () {
      var retryBtn = document.getElementById("retry-btn");
      var statusEl = document.getElementById("offline-status");
      var badgeEl = document.getElementById("conn-badge");
      if (retryBtn) {
        retryBtn.addEventListener("click", function () {
          if (statusEl) statusEl.textContent = "Comprobando conexión…";
          window.location.reload();
        });
      }
      window.addEventListener("online", function () {
        if (badgeEl) badgeEl.textContent = "Conexión restablecida";
        if (statusEl) statusEl.textContent = "Conexión detectada. Recargando aplicación…";
        window.location.reload();
      });
    })();
  </script>
</body>
</html>`;

function buildOfflineShellResponse() {
  return new Response(OFFLINE_SHELL_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isCacheableResponse(response) {
  if (!response || !response.ok || response.status !== 200) {
    return false;
  }
  if (response.type !== "basic") {
    return false;
  }
  if (response.headers.has("set-cookie")) {
    return false;
  }
  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) {
    return false;
  }
  return true;
}

function isForbiddenPath(pathname) {
  return (
    pathname === "/sw.js" ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/data/") ||
    pathname.startsWith("/_next/image") ||
    pathname.startsWith("/_next/webpack-hmr") ||
    pathname.includes(".hot-update.")
  );
}

function hasPrivateOrDynamicRequestHints(request, url) {
  if (request.headers.has("authorization")) return true;
  if (request.headers.has("next-action")) return true;
  if (request.headers.has("rsc")) return true;
  if (request.headers.has("next-router-state-tree")) return true;
  if (request.headers.has("next-router-prefetch")) return true;
  if (url.searchParams.has("_rsc")) return true;
  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (accept.includes("text/x-component")) return true;
  return false;
}

function isImmutableStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/");
}

function isShellStaticAsset(pathname) {
  return (
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icons/")
  );
}

async function precacheShellAssets() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(OFFLINE_SHELL_KEY, buildOfflineShellResponse());

  await Promise.allSettled(
    PRECACHE_URLS.map(async (assetUrl) => {
      try {
        const response = await fetch(new Request(assetUrl, { cache: "no-cache" }));
        if (isCacheableResponse(response)) {
          await cache.put(assetUrl, response.clone());
        }
      } catch {
        // Ignore individual precache misses; runtime handlers still work safely.
      }
    }),
  );
}

async function handleCacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function handleStaleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }
  return new Response("", { status: 504, statusText: "Offline" });
}

async function handleNavigation(request) {
  try {
    // Always fetch navigations from network; never persist authenticated or no-store HTML.
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cachedShell = await cache.match(OFFLINE_SHELL_KEY);
    return cachedShell || buildOfflineShellResponse();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShellAssets());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !ALLOWED_CACHES.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      ),
    );
    return;
  }
  if (data.type === "GET_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isForbiddenPath(url.pathname) || hasPrivateOrDynamicRequestHints(request, url)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isImmutableStaticAsset(url.pathname)) {
    event.respondWith(handleCacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isShellStaticAsset(url.pathname)) {
    event.respondWith(handleStaleWhileRevalidate(request, SHELL_CACHE));
  }
});
