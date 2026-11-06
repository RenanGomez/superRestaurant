## Estado
done — Editor del menú separado en 4 pestañas accesibles con persistencia de borrador, sincronización de URL, filtros y tarjeta de producto pulida.

## Qué hice
- Creado `menu-tabs.ts` con helpers puros de pestañas (`categorias`, `productos`, `modificadores`, `tamanos`), parsing, sincronización URL `?tab=` y `localStorage`.
- Implementada barra accesible (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, flechas/Home/End, min 44 px) y 4 paneles `role="tabpanel"`.
- Estado del borrador preservado íntegramente al cambiar de pestaña; encabezado de versión, cambios sin publicar y botón de publicar fijos fuera de pestañas.
- En Productos: botón «Duplicar» movido a fila 1 junto a «Activo» y «×»; anchos corregidos (precio 7.5rem, unidad 9rem, SKU 10rem, estación 12rem); enlace «Gestionar grupos» lleva a Modificadores.
- En Modificadores: filtro por nombre, contador «Asignado a N productos» y texto de ayuda sobre grupos como especialidades.
- En Tamaños y presets: banner «Pronto podrás definir tamaños una sola vez y elegirlos en cada producto», resumen de presentaciones y listado agrupado con enlace a Productos.

## Archivos tocados
- `apps/web/src/lib/menu-tabs.ts` — helpers puros de validación, URLs y storage.
- `apps/web/src/lib/menu-tabs.test.ts` — suite unitaria completa de navegación y storage.
- `apps/web/tsconfig.test.build.json` — registro para compilación de tests.
- `apps/web/package.json` — ejecución en script test de web.
- `apps/web/src/app/app/menu/page.tsx` — paso de `initialTab` desde searchParams.
- `apps/web/src/app/app/menu/menu-catalog-editor.tsx` — pestañas, paneles, filtros, ajustes de layout y enlaces.

## Verificación
```
Command: pnpm turbo run lint typecheck test build --filter=@super-restaurant/web
Tasks:    12 successful, 12 total
Cached:    12 cached, 12 total
Time:    128ms >>> FULL TURBO
Commit: 875ad7c492ed9961c8b670eaa2d659da01dced2c en gemini/menu-tabs-r2
```
NO VERIFICADO: Navegador real /app/menu porque los servidores locales no están iniciados en el entorno (puerto 8082 inactivo); probado con suite unitaria, lint, typecheck y build Next.js.
Confirmación: En `FractionEditor` se preserva la ausencia de línea superior sobre «Mitades»; la sección de ingredientes usa «Ingredientes que no se pueden quitar» tras la migración de `menu-locked-ingredients`.

## Riesgos / dudas
- Ninguno bloqueante; cambios 100% en `apps/web` sin mutar API ni contratos.

## Notas propuestas
- ninguna
