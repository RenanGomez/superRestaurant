# Auditoría preliminar de licencias de terceros

- Fecha: 2026-09-04
- Alcance: dependencias instaladas desde el lockfile de `main`; no incluye el
  worktree móvil de Claude ni paquetes que se agreguen después.
- Objetivo: identificar riesgos antes de una distribución comercial. Este
  documento no sustituye asesoría jurídica ni constituye todavía un archivo de
  avisos listo para distribución.

## Resultado

Todos los workspaces actuales declaran `private: true` y `license: UNLICENSED`.
La enumeración del grafo de producción de pnpm encontró 202 paquetes externos;
169 pudieron cruzarse con metadata local de licencia:

| Licencia declarada | Paquetes |
|---|---:|
| MIT | 148 |
| ISC | 9 |
| Apache-2.0 | 6 |
| BSD-3-Clause | 3 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |

No apareció metadata AGPL, GPL, SSPL, BUSL o Commons Clause en los 169 paquetes
resueltos. Esto no es una conclusión jurídica de compatibilidad.

## Riesgos abiertos

- `@img/sharp-win32-x64@0.35.4` declara
  `Apache-2.0 AND LGPL-3.0-or-later`; antes de distribuir un artefacto que lo
  incorpore deben conservarse los avisos aplicables y revisarse las obligaciones
  de la biblioteca nativa enlazada.
- 33 dependencias opcionales del grafo no tenían un manifest local materializado
  para cruzar metadata. Corresponden principalmente a binarios `@img/sharp-*`,
  `@img/sharp-libvips-*`, `@next/swc-*` de plataformas distintas y
  `@emnapi/runtime`.
- El comando nativo `pnpm licenses list --prod --json` no pudo leer un índice
  local de paquete aun después de una instalación offline congelada. Se usó como
  respaldo el grafo de producción de `pnpm list` y los manifests del virtual
  store; por ello el inventario debe regenerarse en el pipeline de release.

## Dependencias propuestas pendientes de incorporación (ADR-005 — Fase 3)

Actualización documental del 2026-11-23 alineada con [`docs/adr/ADR-005.md`](./adr/ADR-005.md). Estas dependencias **todavía no están instaladas** en `pnpm-lock.yaml` ni modifican el inventario anterior; se registran de forma anticipada para evaluar obligaciones antes de habilitar Fase 3:

| Plataforma / workspace | Paquete o componente propuesto | Licencia declarada | Impacto y obligación antes de distribuir |
|---|---|---|---|
| Web (`apps/web`, `apps/kds`) | IndexedDB nativo + Web Crypto API + Web Locks API | Estándares web del navegador (sin paquete externo) | Cero dependencias nuevas de terceros. |
| Mobile (`apps/mobile`) | `expo-sqlite` (paquete oficial de Expo SDK 57) | MIT | Compatible con distribución comercial; conservar aviso MIT en `THIRD_PARTY_NOTICES` al agregarlo al lockfile. |
| Mobile (`apps/mobile`, nativo) | SQLCipher Community Edition (habilitado vía config plugin `useSQLCipher: true` de `expo-sqlite`) | BSD-3-Clause / BSD-style (Zetetic) | Exige reproducir atribución y texto de licencia en un apartado visible para el usuario final (p. ej. "Acerca de / Avisos legales") y en `THIRD_PARTY_NOTICES`, o evaluar licencia comercial de Zetetic si se requiere exención de atribución o certificación FIPS. |
| Mobile (`apps/mobile`, ya instaladas) | `expo-secure-store` y `expo-crypto` | MIT | Ya presentes en `apps/mobile/package.json`; incluirlas al regenerar el inventario multi-workspace completo. |

## Gate previo a distribución

1. Ejecutar el inventario en cada plataforma/arquitectura realmente distribuida (incluyendo `apps/mobile` y sus binarios nativos cuando se incorpore `expo-sqlite` + SQLCipher).
2. Resolver la metadata de los 33 paquetes opcionales y revisar cualquier
   licencia copyleft o no estándar con asesoría jurídica.
3. Generar `THIRD_PARTY_NOTICES` con textos y atribuciones exactos de las
   dependencias incluidas en el artefacto final, incluyendo la atribución
   visible de SQLCipher Community Edition en la aplicación móvil si se mantiene
   la edición comunitaria.
4. Repetir la auditoría cuando cambie `pnpm-lock.yaml` o el conjunto de targets.
5. No publicar instaladores, imágenes o bundles comerciales mientras este gate
   permanezca abierto.

