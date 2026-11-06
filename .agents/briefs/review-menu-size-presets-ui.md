# review-menu-size-presets-ui · revisión (sólo lectura, Nivel C)

Revisa el diff `git -C C:\tmp\sr-wt\menu-size-presets-ui diff e7b67586..HEAD` contra el brief `.agents/briefs/menu-size-presets-ui.md` y AGENTS.md §14/§19.2 nivel C. Contratos del servidor: `packages/shared-types/src/menu*.ts` (`MenuSizePresetV1`, `sizePresets`, `sizePresetId`).

Busca sobre todo: payload que el servidor rechazaría (nombre vacío, duplicado por mayúsculas, preset inactivo referenciado por variante, `displayOrder`), borradores viejos en `localStorage` sin `sizePresets`, `isDraftRecord` con 6 claves exactas, falta de prueba del helper `updatePresetVariants`, plural «1 productos», accesibilidad (44 px, labels, foco).

No edites nada. Informe: lista de hallazgos P1/P2/P3 con archivo:línea y la última línea `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
