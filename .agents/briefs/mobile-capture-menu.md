# Brief mobile-capture-menu (Fase 4 rework móvil, nivel C)

## Objetivo
Menú de Captura móvil: carrusel horizontal de categorías con imagen y tarjetas grandes con foto. Fuente: `docs/architecture/MOBILE_CAPTURE_UX.md` (boceto APROBADO por Emmanuel 2026-11-20). Pantalla 390×844 estilo Uber Eats; escritorio no debe romperse.

## Alcance
- Editar SOLO: apps/web/src/app/app/capture/capture-menu.tsx (+ helpers puros en apps/web/src/lib con su test)
- Prohibido: API, SQL, otros archivos, git commit/push. Ningún cálculo de dinero en el cliente: los totales/cotizaciones vienen del API. Sin `alert/confirm/prompt`; targets de 44 px; foco visible; respeta `prefers-reduced-motion`.

## Detalle
Carrusel horizontal de categorías con imagen (respaldo color+iniciales si no hay imagen), tarjetas grandes [foto·nombre·precio] en desplazamiento vertical, búsqueda, categoría activa, estados vacío/error/carga visibles, producto agotado deshabilitado. Reutiliza lo de C5.

## Hecho cuando
lint, typecheck y test web en verde con salida real; helper puro nuevo => test unitario.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/mobile-capture-menu.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
