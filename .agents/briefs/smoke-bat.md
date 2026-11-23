# Brief smoke-bat

## Objetivo
Crear en la raíz del repo el archivo `smoke-local.bat`: un wrapper de 1 comando que levanta API (3000) y web (8082) listos para el smoke, delegando en el arranque existente.

## Alcance
- Archivo a crear: `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\smoke-local.bat`
- Permitido: crear ese único archivo. Leer `tools\agentic\local-servers\start-local.bat` como referencia.
- Prohibido: tocar cualquier otro archivo, duplicar la lógica de arranque, instalar dependencias, git commit/push, ejecutar el bat (no levantes servidores).

## Contexto mínimo
El bat debe:
1. Ser CRLF, `@echo off`, `setlocal`.
2. Calcular la raíz con `%~dp0` (el bat está en la raíz).
3. Comprobar que existe `tools\agentic\local-servers\start-local.bat`; si no, mensaje y `pause`, salir con código 1.
4. Invocar `call "<ruta>\tools\agentic\local-servers\start-local.bat" %1` (pasa `nobuild` si se da) y propagar el `errorlevel` con `exit /b`.
5. Comentarios en español en 3 líneas como máximo: qué hace, uso (doble clic, o `smoke-local.bat nobuild`).

## Hecho cuando
- El archivo existe en la raíz, es un bat válido (sin caracteres fuera de ASCII/Latin-1 que rompan cmd; usa solo ASCII en comentarios).
- No se ejecutó nada más; reporta la ruta creada y el contenido final.

## Pruebas
- Sólo revisión por lectura del contenido. No ejecutar.

## Reporte
Responde en `.harness/runs/smoke-bat/result.md` con máximo 10 líneas: archivo creado, confirmación de que delega en start-local.bat, y cualquier duda.
