# Brief mobile-capture-sheet (Fase 4 rework móvil, nivel C)

## Objetivo
Hoja inferior de producto en móvil. Fuente: `docs/architecture/MOBILE_CAPTURE_UX.md` (boceto APROBADO por Emmanuel 2026-11-20). Pantalla 390×844 estilo Uber Eats; escritorio no debe romperse.

## Alcance
- Editar SOLO: apps/web/src/app/app/capture/product-sheet.tsx
- Prohibido: API, SQL, otros archivos, git commit/push. Ningún cálculo de dinero en el cliente: los totales/cotizaciones vienen del API. Sin `alert/confirm/prompt`; targets de 44 px; foco visible; respeta `prefers-reduced-motion`.

## Detalle
Hoja inferior adaptable (en móvil sube desde abajo; en escritorio conserva su comportamiento), contenido desplazable, botón cerrar, controles de 44 px, cotización y errores visibles, cerrar devuelve al menú conservando la selección. Reutiliza la selección existente.

## Hecho cuando
lint, typecheck y test web en verde con salida real; helper puro nuevo => test unitario.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/mobile-capture-sheet.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
