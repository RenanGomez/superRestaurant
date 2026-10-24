# web-auth-callback-short-refresh-token · aceptar refresh tokens cortos en /auth/callback

## Tarea
web-auth-callback-short-refresh-token · capa L1 `implementer-claude` · nivel C (sólo `apps/web`) · riesgo bajo. Rama `claude/web-auth-callback-short-refresh-token` desde `main`.

## Bug (reproducido el 2026-10-22 con un enlace de recuperación real)
Supabase redirige a `http://localhost:8082/auth/callback#access_token=<799 chars>&expires_at=…&expires_in=3600&refresh_token=pemezsdik2mw&sb=&token_type=bearer&type=recovery`. El `refresh_token` tiene **12 caracteres**. En `apps/web/src/lib/auth-callback.ts` la función `isToken` exige `value.length >= 20`, por lo que `consumeCallback` devuelve `false` sin llamar a `/auth/callback/session` y la página muestra «Enlace no válido». Ningún enlace de recuperación ni de invitación funciona hoy.

## Objetivo
Que `/auth/callback` acepte el refresh token real de Supabase (formato actual: 12 caracteres alfanuméricos en minúscula; pueden ser más largos en otros proyectos) y siga rechazando valores vacíos, con espacios o absurdamente largos.

## Cambios
- `apps/web/src/lib/auth-callback.ts`: separar la validación: `isAccessToken` (JWT: `>= 20` y `<= 8_192`, sin espacios, con dos puntos `.` separando tres segmentos) e `isRefreshToken` (`>= 8` y `<= 512`, sin espacios, sólo `[A-Za-z0-9._~-]`). Usar cada una en su campo. Mantener el resto intacto (scrub del hash antes de validar, rechazo de `error*`, tipos `recovery`/`invite`).
- `apps/web/src/lib/auth-callback.test.ts`: añadir casos: refresh token de 12 caracteres con access token JWT válido → hace el POST y devuelve `true`; refresh token de 7 caracteres → `false` sin POST; refresh token con espacio → `false`; access token sin formato JWT → `false`. Ajustar cualquier caso existente que dependiera del mínimo de 20 para el refresh token.
- Revisar `apps/web/src/app/auth/callback/session/route.ts` (`isCallbackBody`, líneas ~25-31): aplica la misma validación de longitud `>= 20` al cuerpo del POST. Debe aceptar el refresh token corto con las mismas reglas nuevas (reutilizar las funciones exportadas de `auth-callback.ts` si el módulo es importable desde el route handler sin arrastrar código de navegador; si no, duplicar las dos expresiones con un comentario que apunte al origen). Añadir una prueba del route si existe un test para él; si no, cubrirlo en `auth-callback.test.ts` sólo si es importable.

## Invariantes
Sin tocar nada fuera de esos archivos. No registrar ni imprimir tokens. LF. Sin `any`.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web test` (incluye `auth-callback.test.js`)
- `pnpm --filter @super-restaurant/web typecheck`
- `pnpm --filter @super-restaurant/web lint`

## Formato de salida esperado
Resumen, archivos, salida literal de los tres comandos, riesgos. Commit local con conventional commit. Sin merge ni push.
