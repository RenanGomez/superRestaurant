# Brief z0-sepomex-navojoa-data (Z0, nivel B, herramienta de datos)

## Objetivo
Convertir `data/sepomex/colonias.csv` (descargado por Emmanuel) en el seed `supabase/seed-data/navojoa-settlements.csv`, con un script determinista y probado.

## Alcance
- Crear `tools/sepomex/normalize-settlements.ts` (ejecutable con el runner TS que ya use el repo; si no hay uno, `.mjs` en el mismo directorio) y su test con una muestra pequeña inline.
- Escribir `supabase/seed-data/navojoa-settlements.csv`. No tocar `data/sepomex/colonias.csv` (entrada, solo lectura). Prohibido: SQL, API, git commit/push, instalar dependencias.

## Contexto mínimo
- Entrada: UTF-8, CRLF, 643 filas, 3 columnas: `Asentamiento/Colonia,Código Postal,Tipo de Asentamiento`. **No trae municipio**: Emmanuel dice que es el catálogo de Navojoa; no filtres por municipio, pero reporta cualquier CP fuera de 85800-85899 y 85200-85299 como advertencia (no los descartes).
- Salida: columnas `cp,colonia,tipo,colonia_normalizada,municipio,estado` con `municipio=Navojoa`, `estado=Sonora`. `colonia_normalizada` = minúsculas, sin acentos (NFD), espacios colapsados, sin signos.
- Hay duplicados legítimos (misma colonia en CP distintos, o mismo CP con tipos distintos, p. ej. «Beltrones» Ampliación y Colonia): conserva ambos, pero rechaza filas idénticas repetidas. Orden determinista: CP, colonia_normalizada, tipo.
- Valida: CP de 5 dígitos, colonia no vacía; filas inválidas se listan en el informe y no entran.

## Hecho cuando
- Ejecutar dos veces produce el mismo archivo byte a byte. Test con muestra (acentos, duplicados, fila inválida).
- Informe: filas leídas, filas escritas, duplicados exactos, inválidas, CPs fuera de rango, lista de CPs distintos.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Informe de ≤15 líneas con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
