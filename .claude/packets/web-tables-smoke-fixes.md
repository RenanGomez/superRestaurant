# web-tables-smoke-fixes · primera ronda del smoke de Emmanuel (mesas y barra lateral)

## Tarea
web-tables-smoke-fixes · **nivel C** (Codex L2, `-Base main`; si Codex no tiene cuota, implementer-claude). Ritmo: operación. Hallazgos de Emmanuel del 2026-10-07 en `/app/tables` y en la barra lateral de `/app`, con capturas. Reglas: PROJECT_NOTES «Veredicto de la prueba visual 2026-10-01» (claro, al alcance, dos o tres toques, nada sin etiqueta).

## Hallazgos y cómo deben quedar
1. **Plano de mesas desaprovecha la pantalla** (`apps/web/src/app/app/tables/*`, componente del plano). Hoy el lienzo ocupa un ancho fijo (~580 px) dejando dos tercios en blanco y un scroll vertical innecesario; la mesa pegada al borde izquierdo sale cortada y su nombre se trunca («Mes…»). Debe quedar: el lienzo ocupa todo el ancho y alto disponibles del contenedor (grid/escala proporcional al tamaño del salón, conservando las coordenadas guardadas), con margen interior para que ninguna mesa quede fuera o cortada (clamp de posiciones al área visible, también al arrastrar), y el nombre completo visible (tamaño mínimo de mesa o texto en dos líneas; nunca truncado a tres letras). Sin scroll vertical si el plano cabe.
2. **Diálogo de mesa fuera de pantalla** (diálogo «Mesa N» que abre al tocar una mesa). Hoy se ancla abajo y los botones de acción («Abrir cuenta», etc.) quedan fuera del viewport. Debe quedar: centrado, `max-height: 90vh` con scroll interno, botones siempre visibles, foco contenido, Esc cierra; a 390×844 ocupa casi toda la pantalla como hoja inferior con el botón principal fijo.
3. **Mesero: botón sin texto y campo sin etiqueta** (mismo diálogo, sección «Mesero (opcional)»). Hay un botón vacío junto a «Yo» (un mesero sin nombre) y un campo de texto debajo de la ayuda sin etiqueta. Debe quedar: cada botón de mesero muestra nombre o, si no hay, correo o «Mesero sin nombre»; nunca un botón vacío. El campo sin etiqueta: si es «Nombre del cliente/cuenta» o «Comensales», ponerle etiqueta visible y ayuda; si no sirve en este diálogo, quitarlo. Confirmar en el código qué es.
4. **Barra lateral sin nombres** (`apps/web/src/app/app/app-nav.tsx` y layout). Hoy son sólo iconos y un cuadro azul grande sin significado. Debe quedar: en ancho ≥ 1024 la barra muestra icono + etiqueta («Mesas», «Captura», «Órdenes», «Entregas», «Clientes», «Caja», «Zonas», «Resumen», etc.) y la sucursal activa con nombre; en móvil, iconos con etiqueta corta debajo o un botón «Menú» que despliega las etiquetas; el cuadro azul pasa a mostrar la inicial y el nombre de la sucursal (o se elimina si no tiene función); `aria-current` y tooltips se mantienen.

## Criterios de aceptación
- [ ] Capturas comparables: plano a ancho completo con las tres mesas enteras y nombres legibles; diálogo entero en 1280×800 y 390×844; barra con etiquetas.
- [ ] Helpers puros con prueba: clamp de posición al área, escala del plano, etiqueta de mesero.
- [ ] Sin alert/confirm; 44 px; consola limpia (ignorar el aviso de hidratación causado por Grammarly). Puertas: `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.

## Invariantes
Sin API ni SQL; posiciones guardadas intactas (sólo cambia la presentación/escala); sin push.

## Formato de salida
Resumen por hallazgo, archivos, salida literal, riesgos.
