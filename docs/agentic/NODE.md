# Node 24.19.0 en el worktree

`package.json` declara:

```json
"engines": { "node": "24.19.0", "pnpm": "11.19.0" }
```

Turbo, `pnpm` y los scripts del monorepo asumen esa versión. En esta máquina el
`PATH` efectivo pone primero el Node de sistema (`D:\nodejs`, v22.20.0) porque
viene del `PATH` de máquina, que precede al de usuario; la instalación de Node
24 existe en:

```
C:\Users\<usuario>\AppData\Local\Programs\node24   (node v24.19.0, pnpm 11.19.0)
```

El objetivo de este documento es dejar activo Node 24.19.0 de forma reproducible
y **sin shims** (un `node.cmd`/`node.exe` envoltorio rompe turbo, que resuelve
`node` varias veces al lanzar tareas hijas y necesita el `node.exe` real).

## Procedimiento mínimo (este repo)

Dot-sourcea el script incluido; antepone la instalación real de Node 24 al
`PATH` del proceso y valida la versión contra `engines.node`:

```powershell
. .\tools\agentic\use-node24.ps1
node -v          # v24.19.0
pnpm -v          # 11.19.0
```

Verificación completa:

```powershell
powershell -NoProfile -Command ". .\tools\agentic\use-node24.ps1; node -v"
```

Salida esperada: `v24.19.0`.

### Por qué dot-source y no `-File`

`powershell -File .\tools\agentic\use-node24.ps1` ejecuta el script en un
**proceso hijo**. Windows no devuelve variables de entorno al proceso padre, así
que `node -v` en el shell que llamó al script seguiría viendo la versión
anterior. El script sigue funcionando en modo `-File` (deja Node 24 activo para
los procesos que él lance y lo advierte), pero para que **tu shell** y turbo
vean Node 24 hay que dot-sourcear (`. .\tools\agentic\use-node24.ps1`) o lanzar
los comandos dentro de una sesión donde ya se aplicó.

El script no modifica el `PATH` de máquina ni de usuario: el cambio dura lo que
la sesión. Eso evita alterar globalmente la máquina de otros equipos.

### Parámetros

| Parámetro | Uso |
| --- | --- |
| `-NodeHome` | Carpeta que contiene `node.exe`. Por defecto se autodetecta (incluye `%LOCALAPPDATA%\Programs\node24`). |
| `-Expected` | Versión esperada; por defecto se lee de `engines.node` en `package.json`. |
| `SR_NODE24` (variable) | Ruta de respaldo usada como candidata si `-NodeHome` no se pasa. |

## Alternativas con gestor de versión

Si prefieres un gestor en lugar del script, cualquiera de estos deja Node
24.19.0 activo **sin shims** (respeta el `node.exe` real):

- **fnm** (recomendado en PowerShell):

  ```powershell
  winget install Schniz.fnm
  fnm install 24.19.0
  fnm use 24.19.0          # o: fnm env --use-on-cd | Out-String | Invoke-Expression
  node -v                  # v24.19.0
  ```

- **nvm-windows**:

  ```powershell
  nvm install 24.19.0
  nvm use 24.19.0
  node -v
  ```

  nvm-windows administra un único `node.exe` activo (symphony) y no crea shims
  por comando; es compatible con turbo.

- **volta**:

  ```powershell
  volta install node@24.19.0
  volta pin node@24.19.0
  node -v
  ```

  Volta sí intercepta con shims propios; si turbo falla al resolver `node`,
  usa fnm/nvm-windows o el script de arriba.

## Verificación de aceptación

```powershell
. .\tools\agentic\use-node24.ps1; node -v   # v24.19.0
```

Si el resultado no es `v24.19.0`, revisa `-NodeHome` o instala Node 24.19.0 con
alguno de los gestores anteriores.
