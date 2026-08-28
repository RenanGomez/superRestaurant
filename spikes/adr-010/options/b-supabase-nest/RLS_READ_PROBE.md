# ADR-010 opción B: probe remoto de lecturas RLS

`test:option-b:rls` es una comprobación remota opt-in para un proyecto
Supabase aislado. Crea dos usuarios Auth desechables mediante la Admin API
server-only y usa dos clientes independientes con la clave publishable para
leer restaurantes y sucursales.

El probe verifica:

- lectura del restaurante y sucursal propios para cada cliente;
- ausencia de filas del restaurante y sucursal del otro cliente;
- revocación server-only de una membresía y ausencia inmediata de esa
  sucursal en el siguiente read del cliente ya autenticado.

Las credenciales, sesiones, claves y UUIDs permanecen en memoria y nunca se
imprimen. El helper limpia los marcadores, filas de fixture y usuarios Auth en
`finally`, incluso si falla una aserción. La ejecución requiere explícitamente
`ADR010_RUN_SUPABASE=1`, la URL, la clave secret server-only, la clave
publishable, `ADR010_DATABASE_URL` con TLS y
`ADR010_CONFIRM_ISOLATED_PROJECT` igual al project ref; no debe ejecutarse
desde web, mobile, KDS ni SQL Editor.

```sh
pnpm --filter @super-restaurant/adr-010-spike run test:option-b:rls
```

Este probe solo cubre lecturas RLS/Auth y revocación observada en lecturas. No
prueba la mutación crítica de órdenes, concurrencia, transacciones,
idempotencia, backup/restore, realtime ni los gates comunes; su salida no es
score ni GO/NO-GO de ADR-010.
