# Brief review-wave1a (revisión nivel C, SIN escritura)

## Objetivo
Revisar el parche `.harness/state/tmp/wave1a.patch` (cambios de dsh en apps/web: field-hint-tab, capture-menu-category-images, capture-address-state, shell-mobile-nav, capture-drafts-tidy, menu-hide-locked-ingredients). Una sola ronda.

## Criterios (/ponytail-review)
Bugs, accesibilidad (foco, aria, targets de 44 px, teclado), seguridad, carga real, tests que falten, y qué sobra. Atención especial: `app-nav.tsx` (barra inferior móvil: safe-area, hoja «Más», `aria-current`, no duplicar la lista de rutas), `capture-customer.tsx` (limpieza del estado `note`), `capture-workspace.tsx` (reanudar borrador → `detail`; no listar borradores vacíos).

## Alcance
Solo lectura; no edites ni ejecutes nada que escriba. Prohibido git commit/push.

## Hecho cuando
Informe con veredicto APROBAR / CORREGIR, y por hallazgo: severidad (P1/P2/P3), archivo:línea y fix concreto. Si no hay P1/P2, di APROBAR.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail). Informe en `.agents/reports/review-wave1a.md` (≤20 líneas) con bloque ``` con el comando que usaste para leer el parche y la salida real; sin evidencia = NO VERIFICADO.
