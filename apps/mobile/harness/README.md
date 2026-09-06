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
  revalidación), renovar token, notificar una sesión histórica (la primera, la
  segunda o todas), reiniciar la app conservando el escenario y reiniciar el
  arnés completo.
- **Acceso**: cualquier contraseña inicia sesión y emite un token nuevo, como
  hace Auth; la contraseña literal `rechazar` produce el estado de credenciales
  inválidas. El **operador** lo decide el correo: si la parte local empieza por
  `b` entra el operador B (`FIXTURE_USER_B`); cualquier otro correo entra como
  operador A (`FIXTURE_USER_A`). Los dos son sintéticos y no existen en ningún
  entorno.
- **Envío de comanda**: elige qué contesta la integración de borrador —sin
  conexión (lo que trae la app real), aceptado, aceptado lento, conflicto, sin
  autorización, red caída, protocolo inválido y servicio no disponible—. La
  barra imprime los intentos que la pantalla ofreció y las claves exactas de
  cada uno; `Limpiar intentos ofrecidos` los borra. El doble **no hace ninguna
  petición**: solo recibe los intentos y devuelve el resultado elegido.

## Recorrer la comanda

1. Ingresa, elige sucursal y turno; la pestaña **Mesas** ahora es una selección
   táctil. No muestra ocupación ni cuenta: esa lectura no existe en el servidor.
2. Toca una mesa para abrir su borrador. Elige categoría, producto, cantidad y
   modificadores; el botón de agregar permanece deshabilitado mientras el
   catálogo no permita la combinación, y explica por qué.
3. Edita o elimina líneas, y prueba **Descartar borrador**: la confirmación
   ocurre dentro de la pantalla, nunca con `confirm()`.
4. Pulsa **Enviar comanda** dos veces seguidas: la barra debe mostrar un solo
   `crear` + un `ítem` por línea + un `abrir`, y el borrador queda congelado
   mientras el envío está en vuelo.
5. Cambia de turno, de sucursal o cierra sesión con un borrador abierto: debe
   desaparecer por completo.

## Proveedor deliberadamente hostil

El doble de identidad se porta peor que un proveedor real, en las dos formas que
rompen un manejo ingenuo de la sesión:

- **conserva todas las sesiones que ha emitido** —al menos dos tras un ciclo
  completo de cada operador—, así que puede notificar una de hace uno, dos o más
  ciclos;
- **conserva todos los manejadores que se le entregaron**, incluidos los que la
  app ya liberó, y les replica esas sesiones históricas.

La barra de estado muestra el operador vigente y cuántas sesiones históricas
hay guardadas.

## Reproducir el caso de varios ciclos

Con `Datos válidos` seleccionado y el arnés recién reiniciado:

1. Ingresa con `a@example.invalid` y cualquier contraseña → sesión histórica 1.
2. Selecciona una sucursal y confirma que se ven mesas y menú.
3. Pulsa **Salir**.
4. Ingresa con `b@example.invalid` → sesión histórica 2; el encabezado debe
   mostrar el correo del operador B y ninguna sucursal preseleccionada.
5. Pulsa **Salir**. La barra debe indicar `sesiones históricas: 2` o más.
6. Pulsa **Notificar sesión histórica 1**, **Notificar sesión histórica 2** y
   **Notificar todas las históricas**.

Resultado esperado: la aplicación sigue en la pantalla de acceso después de cada
notificación. Ninguna sesión anterior vuelve, ni la del operador A ni la del B,
aunque el proveedor las replique en manejadores que la app ya había liberado.

Para comprobar lo contrario —que la compuerta no bloquea lo legítimo— vuelve a
ingresar (paso 1) y pulsa **Renovar token**: la sesión se renueva sin salir de
la sucursal y sin recargar datos.
