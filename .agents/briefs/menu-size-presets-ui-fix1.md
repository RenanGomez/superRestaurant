# menu-size-presets-ui-fix1 · hallazgos de revisión (Nivel C)

Rama `harness/menu-size-presets-ui-fix1` (parte de 8cb904b9). Revisión completa en `.agents/reports/review-menu-size-presets-ui.md`. Archivos: `apps/web/src/app/app/menu/**`, `apps/web/src/lib/menu-*.ts` y sus tests. No tocar `apps/api`, `packages/*`, SQL.

1. P1 `menu-draft-storage.ts` / `recoverDraft`: un borrador local antiguo sin `sizePresets` no debe sustituir los presets publicados por `[]`. Si falta la clave, conserva los presets del estado actual (`state.catalog?.sizePresets`). Test.
2. P2 desactivar un preset con variantes que lo usan: el servidor lo rechaza. Haz que publicar quede deshabilitado con un motivo claro (estilo `publishDisabledReason`) o pide confirmación en la app y deja esas variantes como personalizadas. Elige lo más simple y coherente con el editor.
3. P2 validar en cliente nombres de preset vacíos/solo espacios y duplicados sin distinguir mayúsculas ni espacios extremos; marcar el campo inválido y bloquear publicar con motivo. Helper puro con test.
4. P2 diálogo de quitar preset: foco al abrir en «Cancelar», `aria-describedby` al texto, Escape cierra, foco vuelve al botón Quitar.
5. P3 plural: «1 producto afectado conservará…», «N productos afectados conservarán…», «Ningún producto lo usa».

Sin `alert/confirm/prompt`, 44 px, español, UTF-8 LF (si tu shell rompe acentos, usa escapes).

## Hecho cuando
Commit local `fix(web-menu): …` si el sandbox lo permite; si no, déjalo sin commitear y dilo. El orquestador corre las puertas.
