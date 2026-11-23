No pude crear `.agents/reports/pizza-vectors.md`: el entorno es de solo lectura. La tabla contiene resultados esperados; **NO VERIFICADO: paridad real dominio/SQL**, porque no ejecuté ambas implementaciones.
Supuestos: precios en centavos; `A:100` identifica opción y precio; `AB` significa presente en ambas mitades; gratuitas por precio ascendente. En empate de precio base con N distintos se usa el UUID menor, propuesta pendiente de aprobación.
| Caso y entradas | Cálculo paso a paso y total esperado |
|---|---|
| 1. Especialidades 1500/1800; N=0/0; sin ingredientes ni extras | Base `max(1500,1800)=1800`; total **1800**. |
| 2. Personalizadas 1000/1000; N=0/0; A:101 izquierda, B:103 derecha | Base 1000; ninguna gratis; `ceil(101/2)=51`, `ceil(103/2)=52`; total **1103**. |
| 3. Personalizadas 1000/1000; N=4/4; A:100 izquierda, B:200 derecha | Dos opciones únicas; ambas gratis; `1000+0=1000`; total **1000**. |
| 4. Personalizadas 1000/1000; N=2/2; A:100 AB, B:200 izquierda, C:300 derecha | Deduplicar A: 3 opciones; A y B gratis; `ceil(300/2)=150`; total **1150**. |
| 5. Personalizadas 1000/1000; N=2/2; A:100 y B:200 AB, D:401 izquierda | A y B gratis; `ceil(401/2)=201`; `1000+201`; total **1201**. |
| 6. Personalizadas 1000/N=1 y 1200/N=2; A:100, B:200 y C:300 AB | Base 1200 y N=2 de la más cara; A y B gratis; C completo 300; total **1500**. |
| 7. Personalizadas 1000/N=1 y 1000/N=2; UUID menor en N=1; A:100 y B:200 AB | Empate: UUID menor → N=1; A gratis; B completo 200; total **1200**. |
| 8. Especialidad 1500/N=0 y personalizada 1000/N=1; A:100 y B:201 en personalizada | Regla mixta propuesta: base 1500; A gratis; `ceil(201/2)=101`; total **1601**. |
| 9. Personalizadas 1000/1000; N=0/0; A:101 AB y extra E:75 AB | A deduplicado y completo 101; extra completo 75, sin consumir N; total **1176**. |
| 10. Personalizadas 1000/1000; N=1/1; A:100 izquierda y la misma opción A:101 derecha | Precios incompatibles para el mismo `optionId`: **error**, sin total. |
```text
rg -n '^## 10\.' AGENTS.md
225:## 10. Multi-restaurante, sucursales y autorización
```