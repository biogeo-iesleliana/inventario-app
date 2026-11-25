# Versión 1.3 — Biblioteca del departamento

Solo libros y publicaciones del departamento: consulta, guías de campo, didáctica, lectura, revistas y audiovisuales. **No se gestionan libros de texto ni préstamos**, y no se guarda ningún dato de alumnado.

## Novedad: tipo de registro «Libros / publicaciones»
- Ficha con título, subtítulo, autores («Apellidos, Nombre», separados por punto y coma), editorial, año, edición, idioma, tipo de publicación, materia, nivel orientativo (ESO, BAT, FPB, Docente) y enlace a la portada.
- **ISBN o ISSN** con comprobación del dígito de control. El ISBN se guarda siempre en 13 cifras sin guiones (un ISBN-10 se convierte solo).
- Botón **«Buscar datos»** en la ficha: rellena los campos vacíos con lo que encuentren Open Library o Google Books. Lo que ya estaba escrito no se toca.
- **Ejemplares opcionales**, como en las colecciones: código, estante, estado (bueno, deteriorado, extraviado) y observaciones. Si se registran, la cantidad se calcula sola.
- Origen: Compra, Dotación o **Donación**.
- Avisa si se da de alta un ISBN que ya está en el inventario.

## Novedad: pestaña «Libros»
- Escribe un ISBN, pega una lista o **fotografía la contraportada**. La app lee el código de barras si el navegador lo permite (Chrome en Android) y, si no (Safari en iPhone), los números impresos con el lector de texto de la versión 1.2.
- Cada ISBN se busca en Open Library y, si allí no está o faltan datos básicos, en Google Books. Si ninguno lo conoce, la fila se rellena a mano.
- La lista de libros por añadir se guarda en el dispositivo hasta que la das de alta. Los datos comunes (ubicación, estante, tipo, materia, categoría y origen) se aplican a todos.
- Si un ISBN ya está en el inventario, pregunta si sumar los ejemplares a esa línea o crear otra.

## Listados
- **«Biblioteca del departamento»**: título, autores, editorial, año, edición, ISBN, idioma, tipo, materia, nivel, ejemplares y ubicación. Se puede agrupar por materia o por tipo de publicación.
- **«Bibliografía (APA 7)»**: ordenada por autor y sin repetir un libro que esté en dos sitios. El PDF sale con los títulos en cursiva y sangría francesa.
- Botón **«RIS (Zotero)»** para llevar la biblioteca a Zotero, Mendeley o EndNote.

## Otros cambios
- «Importar» reconoce las columnas de libros (ISBN, autores, editorial, año, edición, idioma, materia), también con encabezados en inglés como los de Zotero o LibraryThing.
- La búsqueda del inventario encuentra también por ISBN, autor, editorial y materia.
- Ajustes: desplegables de editoriales, materias, tipos de publicación e idiomas.

## Privacidad
- Para buscar un libro solo se envía su **ISBN** a Open Library (Internet Archive) y, si hace falta, a Google Books. No se envía nada del inventario.
- Las portadas se cargan desde esos servicios cuando se muestran, así que ven la dirección IP de quien abre la ficha. Si no lo quieres, deja vacío el campo «Portada».
- La política de seguridad de `index.html` permite solo esos dominios, además de GitHub.

## Cómo actualizar
1. Acepta el *pull request* en `inventario-app`.
2. Espera unos 10 minutos (caché de GitHub Pages) y recarga con Ctrl+F5. Abajo debe poner «v1.3.0».

No hay que tocar el repositorio de datos: los libros se guardan en el mismo `data/inventario.json`.
