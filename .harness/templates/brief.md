# Brief <id>

## Objetivo
<una o dos frases: qué debe quedar hecho>

## Alcance
- Archivos/carpetas: <rutas>
- Permitido: <leer / editar estos archivos / ejecutar tests>
- Prohibido: tocar fuera del alcance, git push/commit, borrar archivos, instalar dependencias (salvo que se diga)
- Temporales/respaldos/logs de depuración: solo en `.harness/state/tmp/`; bórralos al terminar

## Contexto mínimo
<solo lo imprescindible: decisiones previas, convenciones. Cita el mapa en vez de pedir explorar:
 "ver .harness/context/map.md §3 (módulo auth)". No copies AGENTS.md: codex lo lee solo.>

## Hecho cuando
- <criterio verificable 1>
- <criterio verificable 2>

## Pruebas (ahorro de cuota)
- Corre los tests/el juego una vez al terminar el cambio, no tras cada edición. Máximo 3 ciclos de
  probar → corregir; si sigue fallando, para y repórtalo con la salida real.
- Filtra la salida (solo errores/resumen: `| tail -40`, `Select-Object -Last 40`); no vuelques logs enteros.
