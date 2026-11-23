# Brief k4-customer-phone-remove-confirm (K4, nivel C)

## Objetivo
«Quitar» un teléfono en la ficha de cliente hoy sólo edita estado local hasta «Guardar ficha» y al refrescar vuelve. Debe confirmar y guardar de inmediato. Smoke r2 cust 2b.

## Alcance
- `apps/web/src/app/app/customers/customer-editor.tsx` (cuello de botella: eres el único escritor) y helper puro en `apps/web/src/lib/customer-directory.ts` con test.
- Prohibido: `apps/api`, SQL, nuevas server actions (usa la acción de guardado existente), git commit/push.

## Contexto mínimo
- «Quitar» abre un modal propio «¿Quitar el teléfono X?». Al confirmar, guarda la ficha de inmediato con la acción existente.
- Si la ficha tiene otros cambios sin guardar, el modal lo avisa y guarda todo junto.
- No se puede quitar el último teléfono si el contrato exige uno (revisa el contrato en `packages/shared-types` y deshabilita con motivo visible).
- Modal accesible: foco atrapado (`apps/web/src/lib/focus-trap.ts` existe), Escape cierra, targets de 44 px, sin alert/confirm/prompt.
- Error al guardar: mensaje claro y el teléfono sigue en la lista.

## Hecho cuando
- Tests del helper (otros cambios sin guardar, último teléfono, teléfono principal).
- lint, typecheck y test de `@super-restaurant/web` en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web` con `corepack pnpm lint`, `typecheck`, `test` una vez al final (tail -40). Cierra cualquier proceso que levantes. Informe de ≤15 líneas con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
