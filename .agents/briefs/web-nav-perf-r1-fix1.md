# web-nav-perf-r1-fix1 · acentos rotos (Nivel C)

En la rama `harness/web-nav-perf-r1` (commit 46084225), los ocho `apps/web/src/app/app/**/loading.tsx` nuevos tienen caracteres no ASCII sustituidos por `?` («Men?», «Cargando informaci?n?»). Revisa también `git diff e7b67586..HEAD` por cualquier otra línea añadida con el mismo defecto.

- Reescribe los textos en español correcto: «Menú», «Cargando información…», «Órdenes», etc. Guarda los archivos en UTF-8 sin BOM, finales LF. Si tu shell corrompe acentos al escribir, usa escapes JSX (`{"Menú"}`) o entidades (`&eacute;`).
- No toques nada más.

## Hecho cuando
`git diff e7b67586..HEAD | grep "^+" | grep -P "[A-Za-z]\?[A-Za-z]"` no devuelve líneas de texto visible. Commit local `fix(web): acentos en pantallas de carga` si el sandbox lo permite; si no, déjalo sin commitear y dilo.
