"use strict";
// Interfaz: une el compilador, el ensamblador y la máquina con la página.

const $ = (id) => document.getElementById(id);
const CLAVE_ESTADO = "emulador.estado";
const CLAVE_BORRADOR_ANTIGUO = "emulador.fuente";
const PAUSA_GUARDADO_MS = 400;
const ELEMENTOS_CON_SCROLL = ["fuente", "compilado", "memoria", "memoria-datos", "registros", "salida"];
const DIVISORES = {
  codigo: { zona: "zona-codigo", eje: "x", inicial: 50 },
  memoria: { zona: "zona-maquina", eje: "x", inicial: 40 },
  salida: { zona: "zona-maquina", eje: "y", inicial: 62.5 },
  zonas: { zona: "zona-memoria", eje: "y", inicial: 60 },
};
const VISTAS = ["compilador", "emulador", "cpu"];
const DIVISOR_MIN = 15;
const DIVISOR_MAX = 85;
const MAX_LINEAS_SALIDA = 2000;
const COMANDOS = [
  ...ComandosShell.nombres(), "comandos", "help", "run", "clear reg", "clear mem", "set", "add", "sub", "mul", "div",
  "load", "store", "storeinstr", "cmp", "print",
];

let modificado = false;
let anterior = null;      // estado previo, para marcar lo que cambia en cada paso
let huboError = false;
const historial = [];
let posicionHistorial = 0;
const divisiones = {};
let scrolls = {};
let temporizadorGuardado = null;
let guardadoActivo = true;

function escapar(texto) {
  return texto.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function resaltar(texto, regex) {
  return texto.replace(regex, (...args) => {
    const grupos = args[args.length - 1];
    const clase = Object.keys(grupos).find((k) => grupos[k] !== undefined);
    return `\u0001${clase}\u0002${args[0]}\u0003`;
  });
}

function aHtml(marcado) {
  return escapar(marcado)
    .replace(/\u0001(\w+)\u0002/g, '<span class="sx-$1">')
    .replace(/\u0003/g, "</span>");
}

const REGEX_FUENTE = new RegExp([
  "(?<comentario>#.*)",
  "(?<cadena>\"[^\"\\n]*\"|'[^'\\n]*')",
  "(?<clave>\\b(?:para|hasta|paso|finpara|imprimir|caracter|entero|real|booleano|si|entonces|sino|finsi|mientras|fin)\\b)",
  "(?<numero>\\b\\d+(?:\\.\\d+)?\\b)",
  "(?<operador><=|>=|==|!=|:=|[<>+\\-*/])",
].join("|"), "g");

const REGEX_ASM = new RegExp([
  "(?<comentario>;.*)",
  "(?<cadena>\"[^\"\\n]*\")",
  "(?<etiqueta>^\\s*\\w+:)",
  "(?<salto>\\b(?:jmp|je|jne|jg|jl|jge|jle)\\b)",
  "(?<clave>\\b(?:load|store|add|sub|mul|div|cmp|cmplt|cmpgt|cmple|cmpge|cmpeq|cmpne|print)\\b)",
  "(?<registro>\\b(?:[RF]\\d+|AC)\\b)",
  "(?<numero>#-?[\\d.]+|\\[\\d+\\])",
].join("|"), "gm");

/* ---------- Compilador ---------- */

function actualizarEditor() {
  const texto = $("fuente").value;
  $("resaltado").innerHTML = aHtml(resaltar(texto, REGEX_FUENTE)) + "\n";
  const lineas = texto.split("\n").length;
  $("numeros").textContent = Array.from({ length: lineas }, (_, i) => i + 1).join("\n");
  sincronizarScroll();
}

function sincronizarScroll() {
  $("resaltado").scrollTop = $("fuente").scrollTop;
  $("resaltado").scrollLeft = $("fuente").scrollLeft;
  $("numeros").scrollTop = $("fuente").scrollTop;
}

function ponerFuente(texto) {
  $("fuente").value = texto;
  modificado = false;
  actualizarEditor();
  $("compilado").textContent = "";
  ponerEstado("");
}

function ponerEstado(texto, clase = "") {
  $("estado").textContent = texto;
  $("estado").className = `estado ${clase}`;
}

function formato() {
  return $("formato-hex").checked ? "HEX" : "ASM";
}

function mostrarCompilado(texto) {
  $("compilado").innerHTML = formato() === "HEX" ? escapar(texto) : aHtml(resaltar(texto, REGEX_ASM));
}

// Devuelve el programa compilado en el formato elegido, o null si hay errores.
function compilar() {
  const fuente = $("fuente").value;
  if (!fuente.trim()) {
    ponerEstado("No hay código fuente para compilar.", "error");
    return null;
  }
  try {
    const asm = new Compilador().compilar(fuente).join("\n");
    const resultado = formato() === "HEX" ? Ensamblador.asmAHex(asm) : asm;
    mostrarCompilado(resultado);
    const instrucciones = resultado.split("\n").length;
    ponerEstado(`Compilado: ${instrucciones} celdas de memoria.`, "ok");
    return resultado;
  } catch (error) {
    $("compilado").textContent = "";
    ponerEstado(error.message, "error");
    return null;
  }
}

function descargar(nombre, texto) {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([texto], { type: "text/plain" }));
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

// El filtro del diálogo se puede saltar eligiendo "Todos los archivos".
function extensionValida(input, extension) {
  const fichero = input.files[0];
  if (!fichero || fichero.name.toLowerCase().endsWith(extension)) return true;
  input.value = "";
  return false;
}

function leerFichero(input, alLeer) {
  const fichero = input.files[0];
  if (!fichero) return;
  const lector = new FileReader();
  lector.onload = () => {
    alLeer(lector.result, fichero.name);
    programarGuardado();
  };
  lector.readAsText(fichero);
  input.value = "";
}

function descartarCambios() {
  return !modificado || confirm("Se perderán los cambios del editor. ¿Continuar?");
}

function mostrarDialogo(titulo, texto) {
  $("dialogo-titulo").textContent = titulo;
  $("dialogo-texto").textContent = texto;
  $("dialogo").showModal();
}

/* ---------- Emulador ---------- */

const maquina = new Maquina(escribir);
let pendientes = [];

function escribir(tipo, texto) {
  if (tipo === "error") huboError = true;
  const prefijo = { ok: "[OK] ", error: "[ERROR] ", debug: "[DEBUG] ", info: "" }[tipo] || "";
  pendientes.push([tipo, prefijo + texto]);
}

function volcarSalida() {
  const salida = $("salida");
  const nuevas = pendientes.slice(-MAX_LINEAS_SALIDA);
  pendientes = [];
  const fragmento = document.createDocumentFragment();
  for (const [tipo, texto] of nuevas) {
    const linea = document.createElement("div");
    linea.className = `linea-${tipo}`;
    linea.textContent = texto;
    fragmento.append(linea);
  }
  salida.append(fragmento);
  while (salida.childElementCount > MAX_LINEAS_SALIDA) salida.firstElementChild.remove();
  salida.scrollTop = salida.scrollHeight;
}

function bitsReal(valor) {
  const vista = new DataView(new ArrayBuffer(4));
  vista.setFloat32(0, valor);
  const bits = vista.getUint32(0).toString(2).padStart(32, "0");
  return `<span><span class="bit-signo">${bits[0]}</span> ` +
    `<span class="bit-exponente">${bits.slice(1, 9)}</span> ` +
    `<span class="bit-mantisa">${bits.slice(9)}</span></span>`;
}

function bitsEntero(valor) {
  const sinSigno = ((valor % 2 ** 32) + 2 ** 32) % 2 ** 32;
  const bits = Math.trunc(sinSigno).toString(2).padStart(32, "0");
  return `<span class="bits-entero">${bits.replace(/(.{8})(?=.)/g, "$1 ").padEnd(35)}</span>`;
}

function filaRegistro(nombre, valor, real, cambio) {
  const decimal = real ? valor.toFixed(6) : String(valor);
  return `<div class="reg${cambio ? " cambio" : ""}"><span class="nombre">${nombre}</span>` +
    `${real ? bitsReal(valor) : bitsEntero(valor)}<span class="decimal">${decimal}</span></div>`;
}

function capturarEstado() {
  return {
    PC: maquina.PC, SR: maquina.SR, MAR: maquina.MAR, AC: maquina.AC,
    R: [...maquina.R], F: [...maquina.F],
    memoria: maquina.memoria.map((c) => `${c.tipo}:${c.valor}`),
  };
}

function pintarRegistros() {
  const previo = anterior;
  const cambio = (clave) => previo && previo[clave] !== maquina[clave];
  const especiales = ["PC", "SR", "MAR"]
    .map((n) => filaRegistro(n, maquina[n], false, cambio(n))).join("") +
    filaRegistro("AC", maquina.AC, maquina.ACreal, cambio("AC"));
  const banco = (letra, real) => maquina[letra]
    .map((v, i) => filaRegistro(`${letra}${i + 1}`, v, real, previo && previo[letra][i] !== v)).join("");
  $("registros").innerHTML =
    `<div class="grupo"><h3>Especiales</h3>${especiales}` +
    `<div class="ir">IR: ${escapar(maquina.IR)}</div></div>` +
    `<div class="bancos"><div class="grupo"><h3>Enteros</h3>${banco("R", false)}</div>` +
    `<div class="grupo"><h3>Reales · <span class="bit-signo">signo</span> ` +
    `<span class="bit-exponente">exponente</span> <span class="bit-mantisa">mantisa</span></h3>` +
    `${banco("F", true)}</div></div>`;
}

function pintarMemoria() {
  const previo = anterior;
  const filas = maquina.memoria.map((celda, direccion) => {
    const vacia = celda.tipo === "vacio";
    const clases = ["celda"];
    if (vacia) clases.push("vacia");
    if (previo && previo.memoria[direccion] !== `${celda.tipo}:${celda.valor}`) clases.push("cambio");
    if (direccion === maquina.ultimoDato) clases.push("dato");
    if (direccion === maquina.ejecutada) clases.push("actual");
    else if (direccion === maquina.PC && !maquina.terminado && maquina.SIZE) clases.push("siguiente");
    const tipo = celda.tipo === "instruccion" ? "instr" : celda.tipo;
    const valor = vacia ? "" : escapar(String(celda.valor));
    return `<div class="${clases.join(" ")}" data-dir="${direccion}"><span class="direccion">${direccion}</span>` +
      `<span class="tipo">${tipo}</span><span>${valor}</span></div>`;
  });
  $("memoria").innerHTML = filas.slice(0, maquina.SIZE).join("");
  $("memoria-datos").innerHTML = filas.slice(maquina.SIZE).join("");
}

// Hace visible una fila moviendo solo su panel, no la página.
function mostrarFila(panel, fila) {
  if (!fila) return;
  const arriba = fila.offsetTop - panel.offsetTop;
  if (arriba < panel.scrollTop || arriba + fila.offsetHeight > panel.scrollTop + panel.clientHeight) {
    panel.scrollTop = arriba - panel.clientHeight / 2;
  }
}

function seguirPC() {
  const panel = $("memoria");
  mostrarFila(panel, panel.querySelector(".actual") || panel.querySelector(".siguiente"));
}

// La última celda de datos; un programa también puede escribir sobre su propia zona.
function seguirDato() {
  const panel = $("memoria-datos");
  if (maquina.ultimoDato === null) {
    panel.scrollTop = 0;
    return;
  }
  const fila = panel.querySelector(".dato");
  if (fila) mostrarFila(panel, fila);
  else mostrarFila($("memoria"), $("memoria").querySelector(".dato"));
}

function pintar() {
  delete scrolls.memoria;
  delete scrolls["memoria-datos"];
  delete scrolls.salida;
  pintarRegistros();
  pintarMemoria();
  volcarSalida();
  seguirPC();
  seguirDato();
  VistaCPU.sincronizar();
}

function cargarPrograma(texto, origen) {
  try {
    const celdas = maquina.cargar(texto);
    anterior = null;
    escribir("ok", `${origen}: ${celdas} celdas cargadas`);
  } catch (error) {
    escribir("error", error.message);
  }
  pintar();
}

function ejecutarPrograma() {
  if (!maquina.SIZE) {
    escribir("error", "No hay ningún programa cargado");
    return pintar();
  }
  maquina.reiniciar();
  anterior = null;
  huboError = false;
  maquina.correr();
  if (!huboError) escribir("ok", "Programa finalizado");
  pintar();
}

function pasoAPaso() {
  if (!maquina.SIZE) {
    escribir("error", "No hay ningún programa cargado");
    return pintar();
  }
  if (maquina.terminado) {
    maquina.reiniciar();
    escribir("info", "Programa reiniciado");
  }
  anterior = capturarEstado();
  huboError = false;
  maquina.paso();
  if (maquina.terminado && !huboError) escribir("ok", "Programa finalizado");
  pintar();
}

// Devuelve true si la línea era un comando que genera un programa.
function ejecutarComandoShell(texto) {
  const orden = texto.toLowerCase();
  if (orden === "help") maquina.ejecutar(texto);
  if (orden === "help" || orden === "comandos") {
    escribir("info", ComandosShell.ayuda());
    return true;
  }
  const generado = ComandosShell.generar(texto);
  if (!generado) return false;
  const celdas = maquina.cargar(generado.asm);
  anterior = null;
  const listado = generado.asm.split("\n").map((linea, i) => `${String(i).padStart(3)}  ${linea}`);
  escribir("info", `Ensamblador generado:\n${listado.join("\n")}`);
  escribir("ok", `${celdas} celdas cargadas. Pulsa Ejecutar programa o Paso a paso, o escribe run`);
  return true;
}

function ejecutarComando(texto) {
  pendientes.push(["eco", `> ${texto}`]);
  anterior = capturarEstado();
  try {
    if (!ejecutarComandoShell(texto)) maquina.ejecutar(texto);
  } catch (error) {
    escribir("error", error.message);
  }
  pintar();
}

function autocompletar() {
  const entrada = $("comando");
  const coincidencias = COMANDOS.filter((c) => c.startsWith(entrada.value.toLowerCase()));
  if (entrada.value && coincidencias.length === 1) entrada.value = `${coincidencias[0]} `;
  else if (entrada.value && coincidencias.length > 1) {
    pendientes.push(["info", coincidencias.join("  ")]);
    volcarSalida();
  }
}

/* ---------- Eventos ---------- */

function mostrarVista(nombre) {
  recordarScrolls();
  VistaCPU.alCambiarVista(nombre);
  for (const vista of VISTAS) {
    const activa = vista === nombre;
    $(`vista-${vista}`).hidden = !activa;
    $(`pestana-${vista}`).setAttribute("aria-selected", String(activa));
  }
  if (nombre === "emulador") {
    if (!scrolls.memoria) seguirPC();
    if (!scrolls["memoria-datos"]) seguirDato();
    if (!scrolls.salida) $("salida").scrollTop = $("salida").scrollHeight;
  }
  aplicarScrolls();
}

function vistaActual() {
  return VISTAS.find((vista) => !$(`vista-${vista}`).hidden);
}

/* ---------- Divisores ---------- */

function ponerDivisor(nombre, valor) {
  const limitado = Math.min(DIVISOR_MAX, Math.max(DIVISOR_MIN, valor));
  const redondeado = Math.round(limitado * 10) / 10;
  divisiones[nombre] = redondeado;
  const zona = $(DIVISORES[nombre].zona);
  zona.style.setProperty(`--${nombre}-a`, `${redondeado}fr`);
  zona.style.setProperty(`--${nombre}-b`, `${100 - redondeado}fr`);
  $(`divisor-${nombre}`).setAttribute("aria-valuenow", String(Math.round(redondeado)));
}

function arrastrarDivisor(nombre, evento) {
  const { zona, eje } = DIVISORES[nombre];
  evento.preventDefault();
  const rect = $(zona).getBoundingClientRect();
  const mover = (e) => {
    const posicion = eje === "x" ? e.clientX - rect.left : e.clientY - rect.top;
    ponerDivisor(nombre, (posicion / (eje === "x" ? rect.width : rect.height)) * 100);
  };
  const soltar = () => {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
    document.body.classList.remove("arrastrando");
    document.body.style.cursor = "";
    programarGuardado();
  };
  document.body.classList.add("arrastrando");
  document.body.style.cursor = eje === "x" ? "col-resize" : "row-resize";
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);
}

for (const [nombre, { eje, inicial }] of Object.entries(DIVISORES)) {
  const divisor = $(`divisor-${nombre}`);
  divisor.setAttribute("aria-valuemin", String(DIVISOR_MIN));
  divisor.setAttribute("aria-valuemax", String(DIVISOR_MAX));
  divisor.addEventListener("pointerdown", (evento) => arrastrarDivisor(nombre, evento));
  divisor.addEventListener("dblclick", () => ponerDivisor(nombre, inicial));
  divisor.addEventListener("keydown", (evento) => {
    const [menos, mas] = eje === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (evento.key !== menos && evento.key !== mas) return;
    evento.preventDefault();
    ponerDivisor(nombre, divisiones[nombre] + (evento.key === mas ? 2 : -2));
  });
}

/* ---------- Guardar y recuperar el estado en el navegador ---------- */

function elementoVisible(elemento) {
  return elemento.offsetParent !== null;
}

// Un panel oculto siempre informa de scroll 0: solo se anotan los visibles.
function recordarScrolls() {
  for (const id of ELEMENTOS_CON_SCROLL) {
    const elemento = $(id);
    if (elementoVisible(elemento)) scrolls[id] = [elemento.scrollTop, elemento.scrollLeft];
  }
}

function aplicarScrolls() {
  for (const id of ELEMENTOS_CON_SCROLL) {
    const elemento = $(id);
    if (scrolls[id] && elementoVisible(elemento)) [elemento.scrollTop, elemento.scrollLeft] = scrolls[id];
  }
  sincronizarScroll();
}

function guardarEstado() {
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = null;
  if (!guardadoActivo) return;
  recordarScrolls();
  const lineasSalida = [...$("salida").children].map((l) => [l.className.replace("linea-", ""), l.textContent]);
  const estado = {
    vista: vistaActual(),
    fuente: $("fuente").value,
    cursor: [$("fuente").selectionStart, $("fuente").selectionEnd],
    modificado,
    ejemplo: $("ejemplos").value,
    formato: formato(),
    debug: $("debug").checked,
    velocidad: VistaCPU.velocidad(),
    ayuda: posicionAyuda,
    compilado: $("compilado").textContent,
    estado: { texto: $("estado").textContent, clase: $("estado").className.replace("estado", "").trim() },
    divisiones,
    scrolls,
    comando: $("comando").value,
    historial,
    salida: lineasSalida,
    maquina: maquina.exportar(),
  };
  try {
    localStorage.setItem(CLAVE_ESTADO, JSON.stringify(estado));
  } catch (_) { /* sin almacenamiento o sin espacio: la página sigue funcionando */ }
}

function programarGuardado() {
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarEstado, PAUSA_GUARDADO_MS);
}

function leerAlmacen(clave) {
  try {
    return localStorage.getItem(clave);
  } catch (_) {
    return null;
  }
}

function restaurarEstado(estado) {
  for (const [nombre, { inicial }] of Object.entries(DIVISORES)) {
    ponerDivisor(nombre, estado.divisiones?.[nombre] ?? inicial);
  }
  maquina.importar(estado.maquina);
  $("fuente").value = estado.fuente ?? "";
  modificado = Boolean(estado.modificado);
  if (estado.ejemplo in EJEMPLOS) $("ejemplos").value = estado.ejemplo;
  $(estado.formato === "HEX" ? "formato-hex" : "formato-asm").checked = true;
  $("debug").checked = Boolean(estado.debug);
  maquina.debug = $("debug").checked;
  VistaCPU.ponerVelocidad(estado.velocidad);
  posicionAyuda = estado.ayuda ?? null;
  actualizarEditor();
  mostrarCompilado(estado.compilado ?? "");
  ponerEstado(estado.estado?.texto ?? "", estado.estado?.clase ?? "");
  $("comando").value = estado.comando ?? "";
  historial.push(...(estado.historial ?? []));
  posicionHistorial = historial.length;
  pendientes = estado.salida ?? [];
  pintar();
  scrolls = estado.scrolls ?? {};
  if (estado.cursor) $("fuente").setSelectionRange(...estado.cursor);
  mostrarVista(VISTAS.includes(estado.vista) ? estado.vista : "compilador");
}

// Devuelve true si había un estado guardado y se ha podido recuperar.
function recuperarEstadoGuardado() {
  const guardado = leerAlmacen(CLAVE_ESTADO);
  if (!guardado) return false;
  try {
    restaurarEstado(JSON.parse(guardado));
    return true;
  } catch (_) {
    maquina.borrarTodo();
    historial.length = 0;
    pendientes = [];
    return false;
  }
}

$("pestana-compilador").addEventListener("click", () => mostrarVista("compilador"));
$("pestana-emulador").addEventListener("click", () => mostrarVista("emulador"));
$("pestana-cpu").addEventListener("click", () => mostrarVista("cpu"));

$("fuente").addEventListener("input", () => {
  modificado = true;
  actualizarEditor();
});
$("fuente").addEventListener("scroll", sincronizarScroll);
$("fuente").addEventListener("keydown", (evento) => {
  if (evento.key !== "Tab" || evento.shiftKey) return;
  evento.preventDefault();
  document.execCommand("insertText", false, "    ");
});

for (const nombre of Object.keys(EJEMPLOS)) $("ejemplos").add(new Option(nombre, nombre));
$("ejemplos").addEventListener("change", (evento) => {
  if (descartarCambios()) {
    ponerFuente(EJEMPLOS[evento.target.value]);
    compilar();
  }
});

$("nuevo").addEventListener("click", () => {
  if (descartarCambios()) ponerFuente("");
  $("fuente").focus();
});
$("abrir-fuente").addEventListener("click", () => $("fichero-fuente").click());
$("fichero-fuente").addEventListener("change", (evento) => {
  if (!extensionValida(evento.target, ".txt")) {
    ponerEstado("Aquí solo se pueden abrir ficheros .txt.", "error");
  } else if (descartarCambios()) {
    leerFichero(evento.target, (texto) => ponerFuente(texto));
  } else {
    evento.target.value = "";
  }
});
$("guardar-fuente").addEventListener("click", () => {
  descargar("programa.txt", $("fuente").value);
  modificado = false;
});

$("compilar").addEventListener("click", compilar);
for (const id of ["formato-asm", "formato-hex"]) $(id).addEventListener("change", compilar);

$("gramatica").addEventListener("click", () => {
  try {
    mostrarDialogo("Gramática", new Compilador().gramatica($("fuente").value));
  } catch (error) {
    ponerEstado(error.message, "error");
  }
});
$("guardar-compilado").addEventListener("click", () => {
  // Siempre en ensamblador, aunque en pantalla se esté viendo el hexadecimal.
  if (compilar()) descargar("ensamblador.asm", new Compilador().compilar($("fuente").value).join("\n"));
});
$("enviar").addEventListener("click", () => {
  const resultado = compilar();
  if (!resultado) return;
  cargarPrograma(resultado, "Programa compilado");
  mostrarVista("emulador");
});

$("abrir-programa").addEventListener("click", () => $("fichero-programa").click());
$("fichero-programa").addEventListener("change", (evento) => {
  if (extensionValida(evento.target, ".asm")) {
    leerFichero(evento.target, (texto, nombre) => cargarPrograma(texto, nombre));
  } else {
    escribir("error", "Aquí solo se pueden abrir ficheros .asm.");
    pintar();
  }
});
$("ejecutar").addEventListener("click", ejecutarPrograma);
$("paso").addEventListener("click", pasoAPaso);
$("reiniciar").addEventListener("click", () => {
  maquina.reiniciar();
  anterior = null;
  pintar();
});
$("limpiar").addEventListener("click", () => { $("salida").textContent = ""; });
$("debug").addEventListener("change", (evento) => { maquina.debug = evento.target.checked; });

$("consola").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const texto = $("comando").value.trim();
  if (!texto) return;
  historial.push(texto);
  posicionHistorial = historial.length;
  $("comando").value = "";
  ejecutarComando(texto);
});
$("comando").addEventListener("keydown", (evento) => {
  if (evento.key === "Tab") {
    evento.preventDefault();
    autocompletar();
  } else if (evento.key === "ArrowUp" && posicionHistorial > 0) {
    evento.preventDefault();
    $("comando").value = historial[--posicionHistorial];
  } else if (evento.key === "ArrowDown" && posicionHistorial < historial.length) {
    evento.preventDefault();
    posicionHistorial += 1;
    $("comando").value = historial[posicionHistorial] || "";
  }
});

/* ---------- Arranque: un programa real ya compilado y cargado ---------- */

// Zona de la página y parte de la ayuda que le corresponde.
const CONTEXTOS_AYUDA = [
  { selector: "#fuente", seccion: "lenguaje" },
  { selector: "#compilado", seccion: "instrucciones" },
  { selector: "#consola", seccion: "consola" },
  { selector: "#zona-memoria", seccion: "emulador", ancla: "ayuda-memoria" },
  { selector: "#registros", seccion: "emulador", ancla: "ayuda-registros" },
  { selector: "#cpu-fases", seccion: "cpu", ancla: "ayuda-ciclo" },
  { selector: "#cpu-esquema", seccion: "cpu", ancla: "ayuda-buses" },
  { selector: ".cpu-detalle", seccion: "cpu", ancla: "ayuda-microoperaciones" },
];
let contextoUsado = null; // última zona usada, con la pestaña en la que estaba
let posicionAyuda = null; // { x, y } de la ventana de ayuda, o null si está centrada

function anotarContexto(evento) {
  const objetivo = evento.target;
  if (!(objetivo instanceof Element) || objetivo.closest("#ayuda, #abrir-ayuda")) return;
  const contexto = CONTEXTOS_AYUDA.find(({ selector }) => objetivo.closest(selector));
  contextoUsado = contexto ? { ...contexto, vista: vistaActual() } : null;
}

function contextoAyuda() {
  const vista = vistaActual();
  const estado = $("estado");
  if (vista !== "compilador" && !maquina.SIZE) return { seccion: "inicio" };
  if (vista === "compilador" && estado.classList.contains("error") &&
      /^(?:Línea|Falta|El programa)/.test(estado.textContent)) {
    return { seccion: "lenguaje" };
  }
  if (contextoUsado && contextoUsado.vista === vista) return contextoUsado;
  if (vista === "cpu" && VistaCPU.enCurso()) return { seccion: "cpu", ancla: "ayuda-microoperaciones" };
  return { seccion: vista };
}

function mostrarAyuda(seccion, ancla) {
  const cuerpo = $("ayuda-cuerpo");
  for (const parte of cuerpo.querySelectorAll("section")) parte.hidden = parte.dataset.seccion !== seccion;
  for (const boton of $("ayuda-indice").children) {
    boton.setAttribute("aria-current", String(boton.dataset.seccion === seccion));
  }
  for (const titulo of cuerpo.querySelectorAll(".destacado")) titulo.classList.remove("destacado");
  cuerpo.scrollTop = 0;
  if (ancla) {
    const titulo = $(ancla);
    titulo.classList.add("destacado");
    cuerpo.scrollTop = titulo.offsetTop - cuerpo.offsetTop - 8;
  }
}

// Coloca la ventana donde se dejó, siempre dentro de la pantalla. Sin posición
// guardada queda centrada por el navegador.
function colocarAyuda() {
  const ventana = $("ayuda");
  if (!posicionAyuda) {
    ventana.style.inset = "";
    ventana.style.margin = "";
    return;
  }
  const { width, height } = ventana.getBoundingClientRect();
  posicionAyuda = {
    x: Math.max(0, Math.min(window.innerWidth - width, posicionAyuda.x)),
    y: Math.max(0, Math.min(window.innerHeight - height, posicionAyuda.y)),
  };
  ventana.style.margin = "0";
  ventana.style.inset = `${posicionAyuda.y}px auto auto ${posicionAyuda.x}px`;
}

function arrastrarAyuda(evento) {
  if (evento.target.closest("button")) return;
  evento.preventDefault();
  const inicio = $("ayuda").getBoundingClientRect();
  const dx = evento.clientX - inicio.left;
  const dy = evento.clientY - inicio.top;
  const mover = (e) => {
    posicionAyuda = { x: e.clientX - dx, y: e.clientY - dy };
    colocarAyuda();
  };
  const soltar = () => {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
    programarGuardado();
  };
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);
}

function abrirAyuda() {
  if ($("ayuda").open) return;
  const { seccion, ancla } = contextoAyuda();
  $("ayuda").showModal();
  colocarAyuda();
  mostrarAyuda(seccion, ancla);
}

$("ayuda-cabecera").addEventListener("pointerdown", arrastrarAyuda);
$("ayuda-cabecera").addEventListener("dblclick", (evento) => {
  if (evento.target.closest("button")) return;
  posicionAyuda = null;
  colocarAyuda();
  programarGuardado();
});
window.addEventListener("resize", () => {
  if ($("ayuda").open) colocarAyuda();
});

document.addEventListener("pointerdown", anotarContexto);
document.addEventListener("focusin", anotarContexto);
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "F1") return;
  evento.preventDefault();
  abrirAyuda();
});
$("abrir-ayuda").addEventListener("click", abrirAyuda);

for (const { orden, descripcion } of ComandosShell.lista()) {
  const fila = $("ayuda-generadores").insertRow();
  const codigo = document.createElement("code");
  codigo.textContent = orden;
  fila.insertCell().append(codigo);
  fila.insertCell().textContent = `${descripcion}.`;
}
$("ayuda-indice").addEventListener("click", (evento) => {
  if (evento.target.dataset.seccion) mostrarAyuda(evento.target.dataset.seccion);
});

function arrancarDeCero() {
  const EJEMPLO_INICIAL = "programaTabla";
  for (const [nombre, { inicial }] of Object.entries(DIVISORES)) ponerDivisor(nombre, inicial);
  $("ejemplos").value = EJEMPLO_INICIAL;
  ponerFuente(leerAlmacen(CLAVE_BORRADOR_ANTIGUO) || EJEMPLOS[EJEMPLO_INICIAL]);
  const programa = compilar();
  if (programa) cargarPrograma(programa, "Programa compilado");
  else pintar();
}

$("restablecer").addEventListener("click", () => {
  if (!confirm("Se borrará el código, el programa cargado y la disposición guardados en este navegador. ¿Continuar?")) return;
  guardadoActivo = false;
  try {
    localStorage.removeItem(CLAVE_ESTADO);
    localStorage.removeItem(CLAVE_BORRADOR_ANTIGUO);
  } catch (_) { /* no había nada que borrar */ }
  location.reload();
});

// Cualquier uso de la página programa un guardado; al salir se guarda sin esperar.
for (const evento of ["input", "change", "click", "keyup"]) document.addEventListener(evento, programarGuardado);
window.addEventListener("pagehide", guardarEstado);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) guardarEstado();
});

if (!recuperarEstadoGuardado()) arrancarDeCero();
