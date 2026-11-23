# mobile-capture-menu — hecha

Cambios: carrusel horizontal de categorías con foto o respaldo color+iniciales, búsqueda arriba, tarjetas grandes de una columna con foto/nombre/precio, vacío/búsqueda sin resultados con «Limpiar búsqueda», agotado deshabilitado; desde `sm` conserva rail y grid denso.
Archivos: apps/web/src/app/app/capture/capture-menu.tsx
Verificación (desde `apps/web`, Node v22.20.0):
```text
corepack pnpm lint      → $ eslint --max-warnings=0 --config ../../eslint.config.mjs src (sin hallazgos)
corepack pnpm typecheck → $ tsc --noEmit --project tsconfig.json (sin errores)
corepack pnpm test      → exit=0; "# fail 0" en 54 archivos; pass_total=424
```
Riesgos/pendientes: NO VERIFICADO: navegador real a 390×844 y escritorio (requiere la sesión de Emmanuel).
Notas: ninguna
