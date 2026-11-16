# Versión 1.1 — cambios

## Cómo actualizar
1. Descomprime el zip. **No contiene `config.json`**: el del repositorio se queda como está.
2. En `biogeo-iesleliana/inventario-app` → **Add file → Upload files** → arrastra `index.html`, `README.md`, `CAMBIOS-v1.1.md` y las carpetas `css`, `js` y `vendor` → **Commit changes**.
3. Espera unos 10 minutos (caché de GitHub Pages) y recarga la app con Ctrl+F5. Abajo debe poner «v1.1.0».
4. Opcional: en *Ajustes → Configurar el acceso*, vuelve a generar `config.json` indicando la fecha de caducidad del token para que la app avise un mes antes.

No hay que tocar el repositorio de datos: el formato de `inventario.json` y `listas.json` es el mismo.

## Errores corregidos
- Cerrar un diálogo con Esc repetía la respuesta del diálogo anterior (podía confirmar un «Eliminar»).
- Dos guardados seguidos en una ficha borraban del historial la primera modificación; y un guardado simultáneo pisaba el historial ajeno.
- Doble clic en «Añadir al inventario» o «Importar» duplicaba las altas.
- Un corte de red al abrir cerraba la sesión recordada. Ahora solo se cierra si GitHub rechaza el token, y hay botón «Reintentar».
- Fechas y horas del historial en UTC (una o dos horas menos; fecha del día anterior de madrugada).
- Importar CSV: la columna «Fecha de baja» se emparejaba con «Fecha de alta»; se perdía «cantidad indeterminada»; no se normalizaban fechas; no se detectaban duplicados.
- Un valor fuera de lista (tipo o estado) cambiaba sin avisar al guardar la ficha.
- Cambiar el tipo de registro borraba los datos de reactivo/fungible/colección ya escritos.
- La hoja Excel dependía de una librería externa sin verificación de integridad y las fuentes, de Google.
- Salir de una ficha con cambios no avisaba.

## Novedades
- **Avisos**: stock bajo mínimo, caducados y próximos a caducar, pendientes de n.º de referencia, deteriorados, datos por revisar y caducidad del token.
- **Importar PDF** (listados o facturas digitales) con lectura local, asignación de columnas y revisión fila a fila; el CSV usa el mismo flujo.
- **Selección múltiple** en el inventario: cambiar ubicación, armario, categoría o estado, o dar de baja en bloque.
- **Ajustar cantidad** (consumo / entrada) desde la ficha, y propuesta de **sumar** cuando se da de alta algo que ya existe en el mismo sitio.
- **Listados**: agrupar y ordenar; hoja de recuento, fungible y reposición; inventario anual para Secretaría con las bajas del curso.
- Copia de seguridad descargable, botón «Actualizar» y relectura automática al volver a la pestaña.
