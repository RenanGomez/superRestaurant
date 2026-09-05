# Arnés de verificación visual (no distribuible)

Este directorio **no forma parte del bundle de la aplicación**. Metro solo lo
resuelve cuando `MOBILE_VISUAL_HARNESS=1`, mediante el alias declarado en
`metro.config.js`; cualquier `expo export` o `expo start` sin esa variable
produce el mismo bundle que sin el arnés.

Sirve para inspeccionar en un navegador real las pantallas autenticadas sin
credenciales, sin servidor y sin tocar ningún entorno remoto: las respuestas
provienen de las fixtures sintéticas de `src/test-fixtures.ts` (identificadores
fabricados y moneda ISO de prueba `XTS`).

El cliente HTTP, los parsers compartidos y la máquina de estados de la
aplicación se ejecutan sin cambios: solo se sustituyen la red y el proveedor de
identidad.

## Ejecutar

```bash
MOBILE_VISUAL_HARNESS=1 pnpm --filter @super-restaurant/mobile run web
```

En PowerShell:

```powershell
$env:MOBILE_VISUAL_HARNESS = "1"; pnpm --filter @super-restaurant/mobile run web
```

## Controles

- **Escenarios**: datos válidos, acceso revocado, sesión expirada, sin
  sucursales, red caída, respuesta lenta, sesión ilegible (el puerto de sesión
  rechaza), cierre colgado (`signOut` nunca resuelve) y cierre fallido
  (`signOut` rechaza).
- **Ciclo de vida**: ir a segundo plano, volver a primer plano (dispara la
  revalidación), renovar token, notificar tardíamente la sesión anterior,
  reiniciar la app conservando el escenario y reiniciar el arnés completo.
- **Acceso**: cualquier contraseña inicia sesión y emite un token nuevo, como
  hace Auth; la contraseña literal `rechazar` produce el estado de credenciales
  inválidas.
