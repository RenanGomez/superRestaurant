# Flujo crítico por HTTP contra PostgreSQL local desechable

Prueba de integración opcional (fuera de la cadena `test` normal) que arranca el AppModule real de
NestJS contra un PostgreSQL 17 portátil y desechable. Nunca toca Supabase ni ninguna base compartida
y no usa `ADR010_DATABASE_URL`.

## Requisitos

- Windows con Node 24 y pnpm 11 en el PATH.
- PostgreSQL 17 portátil en `.cache/postgres-local/pgsql` (ignorado por Git). En un worktree, enlazar
  `.cache` con una junction al del repositorio principal. Si falta, la prueba falla con
  `LOCAL_POSTGRES_MISSING`.

## Ejecutar

```
pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only
```

Sin la bandera `--local-disposable-only` falla con `LOCAL_CONFIRMATION_REQUIRED`. Tarda unos 30 s:
crea el cluster, aplica todas las migraciones, abre `app_api` con una contraseña aleatoria y apaga el
cluster en `finally` (salida `local_cleanup`).

## Qué recorre

Catálogo (solo manager) -> turno -> abrir caja -> orden de mostrador -> producto -> enviar a cocina ->
cobro en efectivo con cambio y propina -> corte X. Comprueba montos enteros (cuenta 25000, cambio 4000,
propina 1000, esperado en caja 36000), replay idéntico (`replayed: true`), replay divergente (409),
versión obsoleta (409), 401 sin token y 403 para el gerente de otro restaurante y para un repartidor.

La autenticación se sustituye únicamente en `AUTH_PRINCIPAL_VERIFIER` (token de fixture -> actor); las
membresías y la autorización se leen de la base real. Soporte: `apps/api/src/operations/local-postgres.ts`,
`http-test-fixtures.ts` y `http-test-app.ts`.

## Fuera de alcance

Entregas, mitades, CI remoto y cobertura (segunda iteración).
