# Brief m3-rev-grant-sql (revisión A · foco SQL/grants)

Diff: main...harness/m3-schema-grant-close

Revisa SOLO el SQL y las pruebas SQL del PR #122 (nivel A, foco privilegios). No escribas archivos:
usa `git show` y lecturas del worktree/PR. No ejecutes PostgreSQL ni Playwright.

Comprueba, en este orden, y cita línea/archivo por cada hallazgo:

1. **Cierre real del ledger crudo:** tras `20261126001200`, ningún rol de cliente
   (`app_api`, `authenticated`, `anon`, `service_role`, `public`) conserva `EXECUTE` en
   `app_private.inventory_record_movement`. Considera rutas alternativas: ownership, `PUBLIC`
   por defecto en funciones nuevas, y si algún wrapper `SECURITY DEFINER` de compras/consumo sigue
   funcionando sin el grant (corre como owner postgres).
2. **Envoltorio manual:** `inventory_record_manual_movement` no permite alcanzar `receipt`,
   `sale_consumption`, `transfer_*` ni compensaciones; valida argumentos, motivo y tipo; fija
   `source = 'inventory_manual'`; conserva la idempotencia del ledger; `security definer` con
   `set search_path = ''` y nombres calificados.
3. **Invariantes SQL:** las pruebas nuevas prueban de verdad (no solo `has_function_privilege`):
   registro + saldo, replay `duplicate`, rechazo de `receipt` sin fila, y el par huérfano sembrado
   como owner. Detecta aserciones débiles, `raise` que se comerían el error real o pruebas que
   podrían pasar sin la migración.
4. **Regresiones:** el cambio de rol (`reset role` / `set local role app_api`) dentro del test no
   deja el contexto sucio ni oculta fallos; el verificador exige la migración nueva.

Entrega el informe con `VEREDICTO: APROBAR|CORREGIR` y hallazgos P1/P2/P3 con archivo y línea.
