# Brief mobile-capture-steps (Fase 4 rework móvil, nivel C)

## Objetivo
Barra flotante y pasos pedido → cliente → entrega en móvil. Fuente: `docs/architecture/MOBILE_CAPTURE_UX.md` (boceto APROBADO por Emmanuel 2026-11-20). Pantalla 390×844 estilo Uber Eats; escritorio no debe romperse.

## Alcance
- Editar SOLO: apps/web/src/app/app/capture/capture-ticket.tsx, apps/web/src/app/app/capture/capture-workspace.tsx, apps/web/src/app/app/capture/capture-customer.tsx
- Prohibido: API, SQL, otros archivos, git commit/push. Ningún cálculo de dinero en el cliente: los totales/cotizaciones vienen del API. Sin `alert/confirm/prompt`; targets de 44 px; foco visible; respeta `prefers-reduced-motion`.

## Detalle
Barra flotante [cantidad · total · Ver pedido] y pasos reversibles pedido → cliente → entrega, Atrás conserva lo capturado. El total se muestra SOLO si el API lo expone; si la proyección sólo trae subtotal, muestra «Subtotal» (rotulado así) y deja constancia en el informe. Espacio para la barra inferior de R1 (safe-area).

## Hecho cuando
lint, typecheck y test web en verde con salida real; helper puro nuevo => test unitario.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/mobile-capture-steps.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
