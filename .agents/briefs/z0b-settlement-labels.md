# Brief z0b-settlement-labels (Z0b, nivel B)

## Objetivo
Añadir al seed de asentamientos una columna `etiqueta` (texto que verá el operador) que distinga nombres repetidos. Decisión de Emmanuel: «Beltrones» como Ampliación y como Colonia se muestran como «Beltrones» y «Beltrones (ampliación)».

## Alcance
- Editar `tools/sepomex/normalize-settlements.mjs` y su test; regenerar `supabase/seed-data/navojoa-settlements.csv`. No tocar `data/sepomex/colonias.csv`. Prohibido: SQL, API, git commit/push.

## Regla de `etiqueta`
- Nombre único (por nombre normalizado) → `etiqueta` = colonia tal cual.
- Mismo nombre con tipos distintos → el tipo «Colonia» queda sin sufijo; los demás llevan el tipo en minúscula entre paréntesis: «Beltrones (ampliación)», «Rosales (ranchería)».
- Mismo nombre y mismo tipo en CP distintos (p. ej. varias «Santa Isabel» ranchería) → sufijo con el CP: «Santa Isabel (ranchería, 85xxx)».
- Si no hay tipo «Colonia» entre los repetidos, todos llevan sufijo de tipo. La `etiqueta` debe ser única en todo el archivo: valida y falla si no lo es.
- Conserva `colonia` y `colonia_normalizada` como están (la normalizada sigue sin sufijo; la unicidad de identidad la dará el id en SQL).

## Hecho cuando
- Tests: Beltrones (Ampliación + Colonia), repetido mismo tipo con CP distinto, nombre único, unicidad de `etiqueta`.
- Ejecutar dos veces produce el mismo archivo. Informe: cuántas etiquetas llevan sufijo y 5 ejemplos.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Informe de ≤15 líneas con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
