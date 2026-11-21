# mobile-capture-steps · R2-3 · nivel C · REVIEW

Cambios en `capture-ticket.tsx` y `capture-workspace.tsx` (`capture-customer.tsx` no se tocó): barra fija [cantidad · Total · Ver pedido] sobre la nav de R1 (`bottom: 4rem + env(safe-area-inset-bottom)`) y hoja con «Continuar con cliente»; pasos móviles Pedido → Cliente → Entrega con Atrás/Continuar de 44 px, foco visible, scroll que respeta `prefers-reduced-motion` y `Atrás` conserva lo capturado (los pasos solo ocultan secciones; escritorio sigue mostrando todo con `sm:contents`). Usar una dirección avanza a Entrega.
Total: la proyección del API expone `itemsTotalMinor` (con impuestos, `packages/shared-types/src/capture-selection-plan.ts:112`) además de `subtotalMinor`, así que se rotula «Total» con ese campo; ningún cálculo de dinero en cliente.
```text
corepack pnpm lint      → $ eslint --max-warnings=0 --config ../../eslint.config.mjs src   (sin salida = 0 hallazgos)
corepack pnpm typecheck → $ tsc --noEmit --project tsconfig.json   (sin salida = 0 errores)
corepack pnpm test      → EXIT=0; 54 archivos con "# fail 0"; último bloque: "# pass 7 / # fail 0"
```
NO VERIFICADO: navegador real 390×844 y escritorio (requiere sesión autenticada y catálogo real); no se abrió navegador.
