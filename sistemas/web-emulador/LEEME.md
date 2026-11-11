# Versión web del compilador y emulador

Versión en JavaScript de la aplicación PyQt5. No necesita instalación ni servidor: abre `index.html` en el navegador. Para publicarla, copia la carpeta `web/` a cualquier alojamiento de páginas estáticas.

Para comprobar el código, abre `pruebas.html`: debe indicar que todas las pruebas son correctas.

## Ayuda

El botón **Ayuda** de la cabecera, o la tecla F1, explica el uso de cada pestaña, el lenguaje y las instrucciones. Es sensible al contexto: se abre en lo último que se ha usado, en el lenguaje si hay un error de compilación y en los primeros pasos si no hay programa cargado. La ventana se mueve arrastrando su barra superior y recuerda su posición; un doble clic en la barra la centra. Su contenido está en `index.html` y la relación entre zonas y secciones, en `CONTEXTOS_AYUDA` de `js/app.js`.

## Pestaña CPU

Muestra cómo la CPU ejecuta el programa cargado en el emulador. Cada instrucción se desglosa en micropasos de captación, decodificación y ejecución, con los datos moviéndose por los buses. El panel lateral explica cada micropaso en notación de transferencia de registros, como `MAR ← PC`.

Es un modelo didáctico: A y B son las entradas de la ALU y no aparecen entre los registros del emulador. La instrucción se ejecuta de verdad al terminar su último micropaso, y los valores salen de la propia máquina. `pruebas.html` comprueba que los micropasos llegan al mismo estado que ella en todos los ejemplos.

## Comandos que generan programas

En la consola, comandos como `tabla 5`, `suma 3 4` o `factorial 5` generan un programa, muestran su ensamblador y lo dejan cargado en memoria. `comandos` muestra la lista. Cada uno está definido en `js/comandos.js`: escribe código fuente y lo pasa por el compilador real.

## Memoria

Las pestañas Emulador y CPU muestran la memoria en dos zonas: **Programa**, que sigue la instrucción en curso, y **Datos**, que salta a la última celda leída o escrita. Así una escritura como `store AC [200]` se ve aunque el programa esté en otra parte de la memoria.

## Disposición y estado guardado

Los paneles se redimensionan arrastrando los divisores, entre código fuente y compilado, entre memoria y registros, entre esos paneles y la salida, y entre las zonas de programa y datos. También con las flechas del teclado; un doble clic devuelve el divisor a su posición inicial.

La página guarda su estado en el navegador y lo recupera al volver a abrirla: código, programa compilado, opciones, disposición, pestaña activa, posición de scroll, historial de comandos, memoria, registros y salida. El botón **Restablecer** borra todo esto. El estado se guarda en cada navegador y equipo por separado.

## Ficheros

- **Compilador:** **Abrir** y **Guardar** usan el programa fuente en `.txt`; **Guardar compilado** guarda siempre ensamblador en `.asm`, también con la vista HEX activa.
- **Emulador:** **Abrir** carga ficheros `.asm`.

## Archivos

| Archivo | Equivale a |
|---|---|
| `js/compilador.js` | `Compilador.py` |
| `js/ensamblador.js` | `ChipAssembler.py` y `Assembler_print.py` |
| `js/maquina.js` | `Emulador.py` y `VisorEmulador.procesar_comando()` |
| `js/app.js` | Interfaz (`Principal.py`, `EditorCompilador.py`, `VisorEmulador.py`) |
| `js/ciclo.js` | Nuevo: desglose de cada instrucción en micropasos |
| `js/vistacpu.js` | Nuevo: esquema animado de la pestaña CPU |
| `js/comandos.js` | Nuevo: comandos de consola que generan programas |
| `js/ejemplos.js` | Copia de `fuentes/*.txt`; hay que regenerarla si cambian |

## Diferencias con la versión Python

### Errores corregidos

- `==` en condiciones funciona en hexadecimal: se añade `jne` con el opcode `0x10`.
- `si` se puede cerrar con `fin`, como dice el README, además de con `finsi`.
- `mientras a < b` compara dos variables.
- `a := b` copia una variable en otra.
- `a -1` sin espacio es una resta.
- Una constante real en una expresión ya no se trunca: `a * 2.5` multiplica por 2.5.
- Una constante usada por primera vez dentro de un bloque se recarga en cada uso. En Python valía 0 si ese bloque no se había ejecutado.
- `cmp` y `cmplt`, `cmpgt`, etc. admiten registros F e inmediatos reales.
- Los fallos de `cmp` se muestran como error en lugar de cerrar con una excepción.
- El hexadecimal conserva negativos, reales completos, espacios dobles y `;` dentro de cadenas.
- Un texto igual a un operando de `print`, como `"R1"`, se imprime como texto.

### Errores que antes se ignoraban

Ahora se avisa con el número de línea de variables sin declarar, sentencias desconocidas, expresiones de más de dos operandos, comparaciones múltiples, bloques sin cerrar y programas que no caben en memoria. Por eso `b i <= 4`, de `fuentes/programaSINO.txt`, da error; en `js/ejemplos.js` está corregido a `b := i <= 4`.

### Cambios de comportamiento

- Se pasa del compilador al emulador con el botón **Cargar en el emulador**, sin guardar archivo.
- Una instrucción con error detiene el programa. En Python se continuaba con la siguiente.
- Al terminar, los registros conservan sus valores para poder examinarlos. En Python se ponían a cero.
- Un bucle infinito se detiene a las 200.000 instrucciones. En Python se bloqueaba la ventana.
- Los datos no empiezan en la celda 200: el compilador los coloca 4 celdas después del final del programa, así que las direcciones del ASM cambian respecto a Python. Un programa puede ocupar más de 200 celdas si el total cabe en las 256.
- `MAR` se actualiza en cada acceso a memoria, incluida la lectura de cada instrucción.
- El botón **Ejecutar programa** parte de registros y datos a cero. El comando `run` conserva los valores puestos con `set`.

### Formato hexadecimal

Es compatible con el de Python, con dos excepciones: la instrucción `jne` es nueva y los inmediatos van de -16384 a 16383. Python no decodificaba bien los negativos.
