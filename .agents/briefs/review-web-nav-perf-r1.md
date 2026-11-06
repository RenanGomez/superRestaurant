# review-web-nav-perf-r1 · revisión (sólo lectura, Nivel C)

Revisa `git -C C:\tmp\sr-wt\web-nav-perf-r1-fix1 diff e7b67586..HEAD` contra `.agents/briefs/web-nav-perf-r1.md` y AGENTS.md §13/§14.

Busca sobre todo: que el contexto compartido de petición (`apps/web/src/lib/request-context*`, `getRequestSession`, `getRequestMemberships`, `getRequestAuthorizedBranch`) no comparta datos entre peticiones/usuarios (debe usar `React.cache` u otro alcance por petición, nunca módulo global); que ninguna página haya perdido una comprobación de membresía/sucursal o rol; que `Link` no se use para rutas que exigen recarga completa (descargas, cierres de sesión, server actions); consultas paralelizadas que dependan entre sí; `loading.tsx` accesibles.

No edites nada. Hallazgos P1/P2/P3 con archivo:línea y última línea `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
