# menu-tabs-p3 — hecha
Cambios: Añadido anillo visible (focus-visible:ring-2 focus-visible:ring-accent rounded-2xl) en tabpanels; evitado parpadeo al montar sin ?tab= con estado tabResolved y esqueleto; contador de grupo muestra «Sin asignar» (0), «Asignado a 1 producto» (1) o «Asignado a N productos» (N).
Archivos: apps/web/src/app/app/menu/menu-catalog-editor.tsx
Verificación:
```
pnpm turbo run lint typecheck test build --filter=@super-restaurant/web
Tasks:    12 successful, 12 total
Cached:    8 cached, 12 total
Time:    49.787s
```
Riesgos/pendientes: Ninguno. NO VERIFICADO: Navegador real /app/menu porque los servidores locales no están iniciados en el entorno.
Notas: Sin commit según instrucción humana explícita.
