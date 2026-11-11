"use strict";
// Máquina virtual: estado de Emulador.py y lógica de ejecución de
// VisorEmulador.procesar_comando(), sin interfaz. Como en Python, ejecuta texto
// ASM: las líneas hexadecimales se decodifican antes de interpretarse.

const TAM_MEMORIA = 256;
const NUM_REGISTROS = 10;
const LIMITE_INSTRUCCIONES = 200000;

const AYUDA = `Comandos disponibles:
  help                     Mostrar esta ayuda
  run                      Ejecutar el programa cargado
  clear reg                Poner a cero los registros
  clear mem                Vaciar la memoria
  set <reg> <valor>        Asignar un valor (set r1 10)
  add|sub|mul|div <r1> <r2>  Operar dos registros; el resultado va a AC
  load <reg> <#valor|[dir]>  Cargar un registro
  store <reg|#valor|AC> [dir]  Guardar en memoria
  storeinstr [dir] <instr>   Guardar una instrucción en memoria
  cmp <reg> <reg|#valor>   Comparar; el resultado va a SR
  print <texto|reg|[dir]>  Imprimir
También puedes escribir una instrucción en hexadecimal (01 01 00 01 80).`;

const CONDICION_SALTO = {
  jmp: () => true,
  je: (sr) => sr === 0,
  jne: (sr) => sr !== 0,
  jg: (sr) => sr > 0,
  jl: (sr) => sr < 0,
  jge: (sr) => sr >= 0,
  jle: (sr) => sr <= 0,
};

const COMPARACIONES = {
  cmplt: (a, b) => a < b,
  cmpgt: (a, b) => a > b,
  cmpeq: (a, b) => a === b,
  cmpne: (a, b) => a !== b,
  cmple: (a, b) => a <= b,
  cmpge: (a, b) => a >= b,
};

const ARITMETICA = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
};

function celdaVacia() {
  return { tipo: "vacio", valor: null };
}

class Maquina {
  constructor(escribir = () => {}) {
    this.escribir = escribir; // (tipo, texto); tipo: salida, ok, info, error, debug
    this.debug = false;
    this.borrarTodo();
  }

  borrarTodo() {
    this.memoria = Array.from({ length: TAM_MEMORIA }, celdaVacia);
    this.etiquetas = {};
    this.SIZE = 0;
    this.borrarRegistros();
  }

  borrarRegistros() {
    this.R = new Array(NUM_REGISTROS).fill(0);
    this.F = new Array(NUM_REGISTROS).fill(0);
    this.PC = 0;
    this.IR = "";
    this.SR = 0;
    this.MAR = 0;
    this.AC = 0;
    this.ACreal = false;
    this.terminado = false;
    this.ejecutada = null; // última celda ejecutada, la que muestra IR
    this.ultimoDato = null; // última celda leída o escrita por load o store
  }

  // Deja el programa cargado listo para ejecutarse desde el principio.
  reiniciar() {
    this.borrarRegistros();
    this.memoria = this.memoria.map((c) => (c.tipo === "instruccion" ? c : celdaVacia()));
  }

  // Estado completo en forma de objeto JSON, para guardarlo y recuperarlo.
  exportar() {
    const { memoria, etiquetas, SIZE, R, F, PC, IR, SR, MAR, AC, ACreal, terminado, ejecutada, ultimoDato } = this;
    return { memoria, etiquetas, SIZE, R, F, PC, IR, SR, MAR, AC, ACreal, terminado, ejecutada, ultimoDato };
  }

  importar(datos) {
    if (!Array.isArray(datos.memoria) || datos.memoria.length !== TAM_MEMORIA) {
      throw new Error("Estado de máquina no válido");
    }
    Object.assign(this, datos);
    // JSON convierte Infinity y NaN en null.
    this.R = this.R.map((v) => v || 0);
    this.F = this.F.map((v) => v || 0);
    this.AC = this.AC || 0;
  }

  cargar(texto) {
    this.borrarTodo();
    let direccion = 0;
    for (const original of texto.split(/\r?\n/)) {
      const linea = original.trim();
      if (!linea || linea.startsWith("#") || linea.startsWith(";")) continue;
      if (direccion >= TAM_MEMORIA) throw new Error("Memoria insuficiente para cargar el programa");
      const asm = Ensamblador.quitarComentario(
        Ensamblador.esHex(linea) ? Ensamblador.hexAAsm(linea) : linea
      );
      this.memoria[direccion] = { tipo: "instruccion", valor: asm };
      if (asm.endsWith(":")) this.etiquetas[asm.slice(0, -1)] = direccion;
      direccion += 1;
    }
    this.SIZE = direccion;
    return direccion;
  }

  registro(nombre) {
    const m = /^([RF])(\d+)$/i.exec(nombre);
    if (!m) return null;
    const indice = Number(m[2]) - 1;
    if (indice < 0 || indice >= NUM_REGISTROS) throw new Error(`Registro fuera de rango: ${nombre}`);
    return { banco: m[1].toUpperCase(), indice };
  }

  leer(reg) {
    return this[reg.banco][reg.indice];
  }

  inmediato(texto) {
    if (/^[+-]?\d+$/.test(texto)) return { valor: parseInt(texto, 10), tipo: "entero" };
    if (/^[+-]?\d*\.\d+$/.test(texto)) return { valor: parseFloat(texto), tipo: "real" };
    if (/^'.'$/u.test(texto)) return { valor: texto.codePointAt(1), tipo: "caracter" };
    throw new Error(`Valor inmediato no válido: ${texto}`);
  }

  direccion(texto) {
    const m = /^\[(\d+)\]$/.exec(texto);
    if (!m) throw new Error("La dirección debe ir entre corchetes, como [10]");
    const direccion = Number(m[1]);
    if (direccion >= TAM_MEMORIA) throw new Error(`Dirección fuera de rango: ${direccion}`);
    return direccion;
  }

  // Valor de un registro o de un inmediato: segundo operando de las comparaciones.
  valorComparable(texto) {
    if (texto.startsWith("#")) return this.inmediato(texto.slice(1)).valor;
    const reg = this.registro(texto);
    if (!reg) throw new Error(`Operando no válido: ${texto}`);
    return this.leer(reg);
  }

  depurar(texto) {
    if (this.debug) this.escribir("debug", texto);
  }

  opSet(partes) {
    if (partes.length !== 3) throw new Error("Sintaxis: set <registro> <valor>");
    const reg = this.registro(partes[1]);
    if (!reg) throw new Error("Registro desconocido");
    const { valor } = this.inmediato(partes[2]);
    this[reg.banco][reg.indice] = reg.banco === "R" ? Math.trunc(valor) : valor;
    this.escribir("ok", `${partes[1].toUpperCase()} = ${partes[2]}`);
  }

  opAritmetica(partes) {
    const nombre = partes[0];
    const r1 = partes[1] && this.registro(partes[1]);
    const r2 = partes[2] && this.registro(partes[2]);
    if (partes.length !== 3 || !r1 || !r2) throw new Error("Solo se admiten registros R o F");
    const a = this.leer(r1);
    const b = this.leer(r2);
    if (nombre === "div" && b === 0) throw new Error("División por cero");
    this.AC = ARITMETICA[nombre](a, b);
    // Como en Python, dividir siempre da un real.
    this.ACreal = r1.banco === "F" || r2.banco === "F" || nombre === "div";
    this.depurar(`${nombre} ${a} ${b} → ${this.AC} (AC)`);
  }

  opStore(partes) {
    if (partes.length !== 3) throw new Error("Sintaxis: store <registro|#valor|AC> [direccion]");
    const direccion = this.direccion(partes[2]);
    const origen = partes[1];
    let celda;
    if (origen.toUpperCase() === "AC") {
      celda = { tipo: this.ACreal ? "real" : "entero", valor: this.AC };
    } else if (origen.startsWith("#")) {
      celda = this.inmediato(origen.slice(1));
    } else {
      const reg = this.registro(origen);
      if (!reg) throw new Error("Origen no válido: use un registro, AC o un valor con #");
      celda = { tipo: reg.banco === "R" ? "entero" : "real", valor: this.leer(reg) };
    }
    this.memoria[direccion] = celda;
    this.MAR = direccion;
    this.ultimoDato = direccion;
    this.depurar(`Guardado ${celda.valor} (${celda.tipo}) en memoria[${direccion}]`);
  }

  opLoad(partes) {
    if (partes.length !== 3) throw new Error("Sintaxis: load <registro> <#valor|[direccion]>");
    const reg = this.registro(partes[1]);
    if (!reg) throw new Error("Registro no válido");
    let valor;
    if (partes[2].startsWith("#")) {
      valor = this.inmediato(partes[2].slice(1)).valor;
    } else {
      const direccion = this.direccion(partes[2]);
      const celda = this.memoria[direccion];
      if (celda.tipo === "vacio") throw new Error(`Memoria vacía en la dirección ${direccion}`);
      if (celda.tipo === "instruccion") throw new Error(`La dirección ${direccion} contiene una instrucción`);
      valor = celda.valor;
      this.MAR = direccion;
      this.ultimoDato = direccion;
    }
    this[reg.banco][reg.indice] = reg.banco === "R" ? Math.trunc(valor) : valor;
    this.depurar(`Cargado ${valor} en ${partes[1].toUpperCase()}`);
  }

  opCmp(partes) {
    if (partes.length !== 3) throw new Error("Sintaxis: cmp <registro> <registro|#valor>");
    const a = this.valorComparable(partes[1]);
    const b = this.valorComparable(partes[2]);
    this.SR = Math.sign(a - b);
    this.depurar(`cmp ${a} con ${b} → SR = ${this.SR}`);
  }

  opComparacionBooleana(partes) {
    if (partes.length !== 3) throw new Error(`Sintaxis: ${partes[0]} <registro> <registro|#valor>`);
    const a = this.valorComparable(partes[1]);
    const b = this.valorComparable(partes[2]);
    this.AC = COMPARACIONES[partes[0]](a, b) ? 1 : 0;
    this.ACreal = false;
    this.depurar(`${partes[0]} ${a}, ${b} → ${this.AC}`);
  }

  opSalto(partes) {
    const [nombre, etiqueta] = partes;
    if (partes.length !== 2) throw new Error(`Sintaxis: ${nombre} <etiqueta>`);
    if (!(etiqueta in this.etiquetas)) throw new Error(`Etiqueta no encontrada: ${etiqueta}`);
    if (CONDICION_SALTO[nombre](this.SR)) {
      this.PC = this.etiquetas[etiqueta];
      this.depurar(`${nombre} a ${etiqueta} (PC ← ${this.PC})`);
    }
  }

  opPrint(texto) {
    const argumentos = texto.match(/"[^"]*"|'[^']*'|\[[^\]]+\]|\S+/g) || [];
    const piezas = [];
    for (let i = 0; i < argumentos.length; i++) {
      const argumento = argumentos[i];
      if (/^(["']).*\1$/.test(argumento)) {
        piezas.push(argumento.slice(1, -1));
      } else if (["(char)", "(bool)", "(int)", "(float)"].includes(argumento)) {
        i += 1;
        piezas.push(this.textoConTipo(argumento, argumentos[i]));
      } else if (argumento.startsWith("[")) {
        piezas.push(String(this.memoria[this.direccion(argumento)].valor));
      } else {
        const reg = this.registro(argumento);
        if (!reg) throw new Error(`Argumento no válido en print: ${argumento}`);
        piezas.push(String(this.leer(reg)));
      }
    }
    this.escribir("salida", piezas.join(" "));
  }

  textoConTipo(tipo, nombre) {
    const reg = nombre && this.registro(nombre);
    if (!reg) throw new Error(`Falta el registro tras ${tipo}`);
    const valor = this.leer(reg);
    if (reg.banco === "F") {
      if (tipo !== "(float)") throw new Error(`Tipo ${tipo} no válido para ${nombre}`);
      return valor.toFixed(2);
    }
    if (tipo === "(char)") return String.fromCodePoint(valor);
    if (tipo === "(bool)") return valor ? "true" : "false";
    if (tipo === "(int)") return String(valor);
    throw new Error(`Tipo ${tipo} no válido para ${nombre}`);
  }

  opStoreInstr(partes, texto) {
    if (partes.length < 3) throw new Error("Sintaxis: storeinstr [direccion] <instrucción>");
    const direccion = this.direccion(partes[1]);
    const instruccion = texto.slice(texto.indexOf("]") + 1).trim();
    this.memoria[direccion] = { tipo: "instruccion", valor: instruccion };
    this.escribir("ok", `Instrucción almacenada en memoria[${direccion}]: ${instruccion}`);
  }

  // Ejecuta una instrucción o comando de consola. Lanza Error si no es válida.
  ejecutar(entrada) {
    let comando = entrada.trim();
    if (Ensamblador.esHex(comando)) comando = Ensamblador.hexAAsm(comando);
    comando = Ensamblador.quitarComentario(comando);
    if (!comando) return;

    const minusculas = comando.toLowerCase();
    if (comando.endsWith(":")) {
      this.depurar(`Etiqueta ${comando}`);
      return;
    }
    if (minusculas === "help") return this.escribir("info", AYUDA);
    if (minusculas === "run") return this.correr();
    if (minusculas === "list reg" || minusculas === "list mem") return;
    if (minusculas === "clear reg") {
      this.borrarRegistros();
      return this.escribir("info", "Registros puestos a cero");
    }
    if (minusculas === "clear mem") {
      this.borrarTodo();
      return this.escribir("info", "Memoria vaciada");
    }

    const partes = comando.split(/\s+/);
    const nombre = partes[0] = partes[0].toLowerCase();
    if (nombre === "set") return this.opSet(partes);
    if (nombre in ARITMETICA) return this.opAritmetica(partes);
    if (nombre === "store") return this.opStore(partes);
    if (nombre === "load") return this.opLoad(partes);
    if (nombre === "cmp") return this.opCmp(partes);
    if (nombre in COMPARACIONES) return this.opComparacionBooleana(partes);
    if (nombre in CONDICION_SALTO) return this.opSalto(partes);
    if (nombre === "print") return this.opPrint(comando.slice(5).trim());
    if (nombre === "storeinstr") return this.opStoreInstr(partes, comando);
    throw new Error(`Comando no reconocido: ${comando}`);
  }

  // Ejecuta la instrucción de PC. Devuelve false cuando ya no se puede seguir.
  paso() {
    if (this.PC >= this.SIZE) {
      this.terminado = true;
      return false;
    }
    const celda = this.memoria[this.PC];
    this.ejecutada = this.PC;
    this.MAR = this.PC; // la captación pasa por MAR, como en una CPU real
    if (celda.tipo === "instruccion") {
      this.IR = celda.valor;
      try {
        this.ejecutar(celda.valor);
      } catch (error) {
        this.terminado = true;
        this.escribir("error", `Celda ${this.PC} (${celda.valor}): ${error.message}`);
        return false;
      }
    }
    this.PC += 1;
    if (this.PC >= this.SIZE) this.terminado = true;
    return !this.terminado;
  }

  correr() {
    if (!this.SIZE) return this.escribir("error", "No hay ningún programa cargado");
    this.PC = 0;
    this.terminado = false;
    let pasos = 0;
    while (this.paso()) {
      pasos += 1;
      if (pasos >= LIMITE_INSTRUCCIONES) {
        this.terminado = true;
        return this.escribir("error", `Detenido tras ${pasos} instrucciones: puede ser un bucle infinito`);
      }
    }
  }
}
