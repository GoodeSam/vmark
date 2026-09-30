# Edición con Multicursor

VMark soporta una potente edición con multicursor tanto en el modo WYSIWYG como en el modo Fuente, lo que te permite editar múltiples ubicaciones simultáneamente.

## Inicio Rápido

| Acción | Atajo |
|--------|-------|
| Añadir cursor en la siguiente coincidencia | `Mod + D` |
| Omitir coincidencia, saltar a la siguiente | `Mod + Shift + D` |
| Añadir cursores en todas las coincidencias | `Mod + Shift + L` |
| Añadir cursores en todas las coincidencias del bloque actual | `Alt + Mod + Shift + L` |
| Deshacer la última adición de cursor | `Alt + Mod + Z` |
| Añadir cursor arriba | `Mod + Alt + Arriba` |
| Añadir cursor abajo | `Mod + Alt + Abajo` |
| Añadir/eliminar cursor al hacer clic | `Alt + Clic` |
| Colapsar a un solo cursor | `Escape` |

::: tip
**Mod** = Cmd en macOS, Ctrl en Windows/Linux
**Alt** = Option en macOS
:::

## Añadir Cursores

### Seleccionar Siguiente Ocurrencia (`Mod + D`)

1. Selecciona una palabra o coloca el cursor sobre una palabra
2. Presiona `Mod + D` para añadir un cursor en la siguiente ocurrencia
3. Presiona de nuevo para añadir más cursores
4. Escribe para editar todas las ubicaciones a la vez

<div class="feature-box">
<strong>Ejemplo:</strong> Para renombrar una variable <code>count</code> a <code>total</code>:
<ol>
<li>Haz doble clic en <code>count</code> para seleccionarla</li>
<li>Presiona <code>Mod + D</code> repetidamente para seleccionar cada ocurrencia</li>
<li>Escribe <code>total</code> — todas las ocurrencias se actualizan simultáneamente</li>
</ol>
</div>

### Seleccionar Todas las Ocurrencias (`Mod + Shift + L`)

Selecciona todas las ocurrencias de la palabra o selección actual a la vez:

1. Selecciona una palabra o texto
2. Presiona `Mod + Shift + L`
3. Todas las ocurrencias coincidentes en el documento quedan seleccionadas — o, dentro de un bloque de código, todas las coincidencias de ese bloque (consulta [Alcance](#alcance))
4. Escribe para reemplazarlas todas a la vez

Para quedarte dentro del párrafo, encabezado o elemento de lista en el que estás, usa `Alt + Mod + Shift + L` en su lugar.

### Alt + Clic

Mantén presionado `Alt` (Option en macOS) y haz clic para:
- **Añadir** un cursor en esa posición
- **Eliminar** un cursor si ya existe uno allí

Esto es útil para colocar cursores en posiciones arbitrarias que no son texto coincidente.

### Omitir Ocurrencia (`Mod + Shift + D`)

Cuando `Mod + D` selecciona una coincidencia que no deseas, omítela:

1. Presiona `Mod + D` para comenzar a añadir coincidencias
2. Si la última coincidencia no se desea, presiona `Mod + Shift + D` para omitirla
3. La coincidencia omitida se elimina y se selecciona la siguiente en su lugar

Es el equivalente multicursor de "Buscar Siguiente" — te permite seleccionar cuáles ocurrencias editar.

### Deshacer Suave (`Alt + Mod + Z`)

Deshace la última adición de cursor sin perder todos tus cursores:

1. Presiona `Mod + D` varias veces para acumular cursores
2. Si añadiste uno de más, presiona `Alt + Mod + Z`
3. Se elimina el último cursor añadido, restaurando el estado anterior

A diferencia de `Escape` (que colapsa todo), el deshacer suave retrocede un cursor a la vez.

### Añadir Cursor Arriba/Abajo (`Mod + Alt + Arriba/Abajo`)

Añade cursores verticalmente, una línea a la vez:

1. Coloca el cursor en una línea
2. Presiona `Mod + Alt + Abajo` para añadir un cursor en la siguiente línea
3. Presiona de nuevo para seguir añadiendo cursores hacia abajo
4. Usa `Mod + Alt + Arriba` para añadir cursores hacia arriba

Esto es ideal para editar texto alineado en columnas o para hacer la misma edición en líneas consecutivas.

## Editar con Múltiples Cursores

Una vez que tienes múltiples cursores, toda la edición estándar funciona en cada cursor:

### Escritura
- Los caracteres se insertan en todas las posiciones del cursor
- Las selecciones se reemplazan en todas las posiciones

### Eliminación
- **Retroceso** — elimina el carácter antes de cada cursor
- **Suprimir** — elimina el carácter después de cada cursor

### Navegación
- **Teclas de flecha** — mueven todos los cursores juntos
- **Shift + Flecha** — extiende la selección en cada cursor
- **Mod + Flecha** — salta por palabra/línea en cada cursor

### Escape con Tab

El escape con Tab funciona independientemente para cada cursor:

- Los cursores dentro de **negrita**, *cursiva*, `código` o ~~tachado~~ saltan al final de ese formato
- Los cursores dentro de enlaces escapan del enlace
- Los cursores antes de los corchetes de cierre `)` `]` `}` saltan sobre ellos
- Los cursores en texto sin formato permanecen en su lugar

Esto te permite escapar de múltiples regiones formateadas simultáneamente. Consulta [Navegación Inteligente con Tab](./tab-navigation.md#soporte-multicursor) para más detalles.

### Portapapeles

**Copiar** (`Mod + C`):
- Copia el texto de todas las selecciones, separado por saltos de línea

**Pegar** (`Mod + V`):
- Si el portapapeles tiene el mismo número de líneas que cursores, cada línea va a cada cursor
- De lo contrario, el contenido completo del portapapeles se pega en todos los cursores

## Alcance

**El código tiene alcance limitado; la prosa no.** Dentro de un bloque de código (WYSIWYG) o de un bloque delimitado (Fuente), los cursores nunca cruzan la delimitación — buscar el nombre de una variable en un fragmento no puede colocar un cursor en otro. En la prosa normal, `Mod + D` y `Mod + Shift + L` buscan en **todo el documento**.

Eso suele ser lo que quieres, y a veces no: en un documento largo, buscar una palabra común coloca cursores en párrafos muy alejados de la pantalla.

### Seleccionar Todas las Ocurrencias en el Bloque

`Alt + Mod + Shift + L` selecciona todas las coincidencias **solo dentro del bloque actual** — el párrafo, encabezado o elemento de lista en el que está el cursor. En el modo Fuente, las líneas en blanco delimitan el bloque; en WYSIWYG lo delimita el bloque que lo contiene. Dentro de un bloque de código delimitado se comporta exactamente igual que `Mod + Shift + L`, ya que ese bloque ya es el bloque.

Los dos atajos son hermanos, no un modo: `Mod + Shift + L` sigue abarcando todo el documento, así que nada de lo que ya usas cambia.

<div class="feature-box">
<strong>¿Cuál usar?</strong>
<p>Usa la versión limitada al bloque cuando la palabra es común — al renombrar una variable mencionada en la prosa, o al editar el patrón de un solo elemento de lista. Usa la de todo el documento cuando realmente quieres decir en todas partes.</p>
</div>

## Colapsar Cursores

Presiona `Escape` para colapsar de nuevo a un solo cursor en la posición principal.

::: tip Estabilidad del cursor
Los cursores colapsados permanecen estables cuando se inserta texto en la posición del cursor. No se expandirán inesperadamente a selecciones después de inserciones mapeadas (corregido en v0.6.x).
:::

## Retroalimentación Visual

- **Cursor principal** — cursor parpadeante estándar
- **Cursores secundarios** — cursores parpadeantes adicionales con estilo distinto
- **Selecciones** — la selección de cada cursor está resaltada

En el modo oscuro, los colores del cursor y la selección se ajustan automáticamente para mejor visibilidad.

## Comparación de Modos

| Función | WYSIWYG | Fuente |
|---------|---------|--------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Shift + D` (Omitir) | ✓ | ✓ |
| `Mod + Shift + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Deshacer Suave) | ✓ | ✓ |
| `Mod + Alt + Arriba/Abajo` | ✓ | ✓ |
| `Alt + Clic` | ✓ | ✓ |
| Alcance por delimitación | Bloques de código | Bloques de código delimitados |
| Seleccionar todo limitado al bloque | `Alt + Mod + Shift + L` | `Alt + Mod + Shift + L` |
| Búsqueda circular | ✓ | ✓ |

## Consejos y Mejores Prácticas

### Renombrar Variables
1. Haz doble clic en el nombre de la variable
2. `Alt + Mod + Shift + L` para seleccionar todas las coincidencias de este bloque (o `Mod + Shift + L` para todo el documento)
3. Escribe el nuevo nombre

### Añadir Prefijos/Sufijos
1. Coloca el cursor antes/después del texto repetido
2. `Mod + D` para añadir cursores en cada ocurrencia
3. Escribe el prefijo o sufijo

### Editar Elementos de Lista
1. Selecciona el patrón común (como `- ` al inicio de línea)
2. `Mod + Shift + L` para seleccionar todos
3. Edita todos los elementos de la lista a la vez

### Cuándo Usar Cada Atajo

| Escenario | Mejor Atajo |
|-----------|-------------|
| Selección cuidadosa e incremental | `Mod + D` |
| Omitir coincidencia no deseada | `Mod + Shift + D` |
| Reemplazar todas en el bloque actual | `Alt + Mod + Shift + L` |
| Reemplazar todas en el documento | `Mod + Shift + L` |
| Deshacer el último paso del cursor | `Alt + Mod + Z` |
| Editar líneas consecutivas | `Mod + Alt + Arriba/Abajo` |
| Posiciones arbitrarias | `Alt + Clic` |
| Salida rápida | `Escape` |

## Limitaciones

- **Nodos atómicos**: No se pueden colocar cursores dentro de imágenes, contenido incrustado o bloques de matemáticas en el modo WYSIWYG
- **Entrada IME**: Al usar métodos de entrada (chino, japonés, etc.), la composición solo afecta al cursor principal
- **Bloques de código**: Dentro de un bloque de código (WYSIWYG) o de un bloque delimitado (Fuente), la búsqueda de ocurrencias nunca sale de ese bloque

## Referencia de Teclado

| Acción | Atajo |
|--------|-------|
| Seleccionar siguiente ocurrencia | `Mod + D` |
| Omitir ocurrencia | `Mod + Shift + D` |
| Seleccionar todas las ocurrencias | `Mod + Shift + L` |
| Deshacer cursor suave | `Alt + Mod + Z` |
| Añadir cursor arriba | `Mod + Alt + Arriba` |
| Añadir cursor abajo | `Mod + Alt + Abajo` |
| Añadir/eliminar cursor | `Alt + Clic` |
| Colapsar a un solo cursor | `Escape` |
| Mover todos los cursores | Teclas de flecha |
| Extender todas las selecciones | `Shift + Flecha` |
| Saltar por palabra | `Alt + Flecha` |
| Saltar por línea | `Mod + Flecha` |

<!-- Styles in style.css -->
