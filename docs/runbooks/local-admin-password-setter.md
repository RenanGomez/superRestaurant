# Establecer la contraseña del administrador existente

Este procedimiento es la alternativa local y excepcional cuando el recovery sin correo ya consumió su único intento pero no pudo entregar una sesión. Actualiza la contraseña de la cuenta existente mediante Supabase Admin API; no crea otro usuario, no cambia roles y no depende de redirects.

## Límites de seguridad

- Destino fijo: proyecto `zwbyiefqeujstyzysydn` y cuenta `rgafrog@gmail.com`.
- La identidad se contrasta con `auth.users` y el grant activo en `app.system_admins` dentro de una transacción `READ ONLY` con TLS verificado.
- La clave administrativa solo se carga en el proceso local de la herramienta. Nunca llega a `apps/web`.
- La contraseña viaja una sola vez desde un formulario servido en `127.0.0.1`; no se imprime ni se escribe en disco. El POST exige Host/loopback exactos, formato y campos cerrados, y nonce CSRF aleatorio. Los metadatos opcionales `Origin` y `Sec-Fetch-Site` se validan cuando el navegador los envía; el navegador interno puede omitir ambos.
- `tmp/local-admin-password-set.attempt.json` se crea de forma exclusiva antes de la mutación. No se borra ni se reintenta automáticamente, incluso si queda en `failed`.
- El journal de recovery `tmp/local-admin-recovery.attempt.json` es independiente y no se modifica.

## Procedimiento

1. Confirmar que la consola local responde en `http://localhost:8082` y que el puerto `4320` está libre.
2. Comprobar que no existe `tmp/local-admin-password-set.attempt.json`. Si existe, detenerse e inspeccionar el estado; no borrarlo.
3. Ejecutar las pruebas de la herramienta:

   ```powershell
   node tools/local-admin-password-setter.test.mjs
   ```

4. Iniciar la herramienta con sus dos gates explícitos:

   ```powershell
   node tools/local-admin-password-setter.mjs --serve --confirm=SET_EXISTING_GLOBAL_ADMIN_PASSWORD
   ```

   El servidor loopback expira a los 60 minutos. Si expira antes del envío y el journal sigue ausente, puede iniciarse de nuevo porque todavía no ocurrió una mutación remota.

5. Abrir `http://127.0.0.1:4320` en el navegador local y ejecutar primero `Comprobar navegador`; esta sonda solo valida transporte/CSRF y no llama a Supabase. Tras volver al formulario, el humano introduce y confirma una contraseña de 12 a 128 caracteres y ejecuta el envío final.
6. Después del envío, comprobar únicamente el estado sanitizado del journal. `updated` permite continuar; `failed` exige detenerse sin reintento.
7. El humano inicia sesión en `http://localhost:8082/login`. Verificar que `/app/system-admin/restaurants` carga con la misma identidad y permisos.

No mostrar la contraseña, tokens, enlaces de recovery, claves ni valores de archivos `.env` durante ninguna comprobación.
