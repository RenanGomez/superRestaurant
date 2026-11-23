# Brief k1-capture-landing-customer-first (K1, nivel C)

## Objetivo
La portada de Captura (sin borrador abierto) lleva arriba el buscador de cliente y la barra de canal/cumplimiento; ya no están dentro de «Nueva captura». Smoke r2 cust 3.

## Alcance
- Editar `apps/web/src/app/app/capture/capture-workspace.tsx` (CW; ubica por símbolo, otras tareas movieron líneas) y reutilizar `capture-customer-search.tsx` (combobox de C2).
- Helper puro `canStartCapture(channel, customer, pickupName)` en `apps/web/src/lib/capture-workspace.ts` con tests en `capture-workspace.test.ts`.
- Prohibido: `apps/api`, SQL, nuevas server actions, git commit/push. Otras tareas escriben en paralelo `customers/customer-editor.tsx`: no lo toques.

## Contexto mínimo
- Domicilio: buscar → encontrado → botón «Nueva captura para <nombre>». No encontrado → alta rápida en la misma pantalla (la acción existente) → «Nueva captura». Nunca se crea borrador sin cliente.
- Recoger: campo de nombre (obligatorio) y teléfono (opcional) → «Nueva captura». Si el contrato actual del borrador no tiene dónde guardar el nombre, no inventes campo: déjalo en estado local de la portada, márcalo con comentario `shortcut:` y repórtalo (otra tarea B de API lo añadirá).
- Mostrador y Mesa: «Nueva captura» directa, sin pedir nada.
- La lista de borradores recuperables queda debajo.
- Elimina del interior de «Nueva captura» el buscador y la barra duplicados.
- Sin alert/confirm/prompt; targets de 44 px; foco visible; textos en español con acentos correctos.

## Hecho cuando
- `canStartCapture` con tests (domicilio sin cliente = false; recoger sin nombre = false; mostrador/mesa = true).
- lint, typecheck y test de `@super-restaurant/web` en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web` con `corepack pnpm lint`, `typecheck`, `test` una vez al final (tail -40). Cierra cualquier proceso que levantes. Informe de ≤15 líneas con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
