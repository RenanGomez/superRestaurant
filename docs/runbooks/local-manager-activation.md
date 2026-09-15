# Activación local del manager de Vittorinos

Este procedimiento excepcional activa la cuenta existente `emmanuel.rgomez@gmail.com` cuando el correo de invitación no fue entregado. No repite el onboarding, no crea usuarios y no modifica membresías ni roles.

## Límites

- Destino fijo: proyecto `zwbyiefqeujstyzysydn`.
- Alcance fijo: rol único `manager` en `Vittorinos Pizza` / `Sucursal Navojoa`, zona `America/Hermosillo`.
- El preflight exige una sola membresía activa, un solo grant activo `manager`, ausencia de privilegio global, cuenta sin confirmar y sin login previo.
- La contraseña se recibe una vez en `127.0.0.1:4321`, no se imprime ni se persiste.
- La única mutación llama a Supabase Admin API con `password` y `email_confirm: true` para la identidad ya existente.
- `tmp/local-manager-activation.attempt.json` se crea exclusivamente antes de la mutación. No borrarlo ni reintentar si existe, incluso con estado `failed`.
- Los journals del recovery y password setter del administrador global son independientes y no se modifican.

## Procedimiento

1. Confirmar que `tmp/local-manager-activation.attempt.json` no existe.
2. Ejecutar pruebas locales: `node --test tools/local-admin-password-setter.test.mjs tools/local-manager-activation.test.mjs`.
3. Iniciar una sola vez: `node tools/local-manager-activation.mjs --serve --confirm=ACTIVATE_EXISTING_VITTORINOS_MANAGER`.
4. Abrir `http://127.0.0.1:4321`, usar primero **Comprobar navegador** y luego establecer la contraseña.
5. Iniciar sesión en `http://localhost:8082/login` como manager.
6. Verificar que la consola ofrece únicamente Vittorinos Pizza / Sucursal Navojoa y que no permite rutas de administrador global.
7. Con la verificación terminada, detener la herramienta local y continuar con la restauración de la API directa en el puerto 3000.

Si el preflight o la mutación falla, conservar el journal, no repetir automáticamente y reportar solo el código sanitizado.
