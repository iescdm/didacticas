"use strict";
// Compilador: lenguaje en español -> ensamblador (texto).
// Versión JavaScript de Compilador.py. Genera el mismo código salvo en los
// errores corregidos, que están descritos en web/LEEME.md.

const PALABRAS_CLAVE = {
  para: "PARA", finpara: "FINPARA", hasta: "HASTA", paso: "PASO",
  mientras: "MIENTRAS", fin: "FIN", imprimir: "IMPRIMIR",
  si: "SI", sino: "SINO", finsi: "FINSI",
};

// Celdas libres entre el final del programa y la primera celda de datos.
const MARGEN_DATOS = 4;

const TIPOS_VARIABLE = ["entero", "real", "caracter", "booleano"];
const OP_ARITMETICOS = { SUMA: "add", RESTA: "sub", MULT: "mul", DIV: "div" };
const OP_RELACIONALES = {
  MENOR: "cmplt", MAYOR: "cmpgt", MENORIGUAL: "cmple",
  MAYORIGUAL: "cmpge", IGUAL: "cmpeq", DISTINTO: "cmpne",
};
// Salto que abandona el bloque cuando la condición NO se cumple.
const SALTO_CONTRARIO = {
  IGUAL: "jne", DISTINTO: "je", MENOR: "jge",
  MAYOR: "jle", MENORIGUAL: "jg", MAYORIGUAL: "jl",
};
const LITERALES_BOOLEANOS = { true: 1, verdadero: 1, false: 0, falso: 0 };

const TOKEN_REGEX = new RegExp([
  "(?<COMENTARIO>#.*)",
  "(?<NUMERO>[+-]?\\d+(?:\\.\\d+)?)",
  "(?<CADENA>\"[^\"\\n]*\"|'[^'\\n]*')",
  "(?<ASIGNAR>:=)",
  "(?<SUMA>\\+)", "(?<RESTA>-)", "(?<MULT>\\*)", "(?<DIV>/)",
  "(?<MENORIGUAL><=)", "(?<MAYORIGUAL>>=)", "(?<IGUAL>==)", "(?<DISTINTO>!=)",
  "(?<MENOR><)", "(?<MAYOR>>)",
  "(?<COMA>,)", "(?<PUNTOYCOMA>;)", "(?<LPAREN>\\()", "(?<RPAREN>\\))", "(?<DOSPTOS>:)",
  "(?<ID>[\\p{L}_][\\p{L}\\p{N}_]*)",
  "(?<ESPACIO>[ \\t\\r]+)",
  "(?<DESCONOCIDO>.)",
].join("|"), "gu");

function lexer(texto) {
  const tokens = [];
  for (const m of texto.matchAll(TOKEN_REGEX)) {
    let tipo = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
    const valor = m[0];
    if (tipo === "ESPACIO") continue;
    if (tipo === "DESCONOCIDO") throw new Error(`Carácter desconocido: ${valor}`);
    if (tipo === "ID" && PALABRAS_CLAVE[valor]) tipo = PALABRAS_CLAVE[valor];

    // "a -1" es una resta, no la variable a seguida del número -1.
    const anterior = tokens.length ? tokens[tokens.length - 1][0] : null;
    if (tipo === "NUMERO" && /^[+-]/.test(valor) && ["ID", "NUMERO", "RPAREN"].includes(anterior)) {
      tokens.push([valor[0] === "-" ? "RESTA" : "SUMA", valor[0]]);
      tokens.push(["NUMERO", valor.slice(1)]);
      continue;
    }
    tokens.push([tipo, valor]);
  }
  return tokens;
}

class Compilador {
  constructor() {
    this.registros = {};
    this.tipoVariables = {};
    this.registrosEntero = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `R${i}`);
    this.registrosReal = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `F${i}`);
    this.codigo = [];
    this.siguienteDato = 0;
    this.contadorEtiquetas = 0;
    this.pila = [];
    this.constantes = {};
  }

  // Una constante cargada dentro de un bloque puede no ejecutarse (rama no
  // tomada, bucle sin iteraciones), así que en ese caso se recarga en cada uso.
  constante(valor, clave = valor) {
    const dentroDeBloque = this.pila.length > 0;
    const existente = this.constantes[clave];
    if (existente) {
      if (!existente.global) this.codigo.push(`load ${existente.reg} #${valor}`);
      return existente.reg;
    }
    const lista = String(valor).includes(".") ? this.registrosReal : this.registrosEntero;
    if (!lista.length) throw new Error("No quedan registros para constantes");
    const reg = lista.shift();
    this.constantes[clave] = { reg, global: !dentroDeBloque };
    this.codigo.push(`load ${reg} #${valor}`);
    return reg;
  }

  nuevaVariable(nombre, tipo = "entero") {
    if (nombre in this.registros) return;
    const lista = tipo === "real" ? this.registrosReal : this.registrosEntero;
    if (!lista.length) throw new Error(`No quedan registros de tipo ${tipo}`);
    this.registros[nombre] = lista.shift();
    this.tipoVariables[nombre] = tipo;
  }

  registroDe(nombre) {
    if (!(nombre in this.registros)) throw new Error(`Variable '${nombre}' no declarada`);
    return this.registros[nombre];
  }

  operando([tipo, valor]) {
    if (tipo === "ID") return this.registroDe(valor);
    if (tipo === "NUMERO") return this.constante(valor);
    throw new Error(`Operando no válido: ${valor}`);
  }

  // El tamaño del programa no se conoce hasta el final: las celdas de datos se
  // escriben como [@n] y reubicarDatos() les da su dirección real.
  celdaDatos() {
    return `[@${this.siguienteDato}]`;
  }

  reubicarDatos() {
    const inicio = this.codigo.length + MARGEN_DATOS;
    let celdas = 0;
    this.codigo = this.codigo.map((linea) => {
      if (!/^(?:load|store) /.test(linea)) return linea;
      return linea.replace(/\[@(\d+)\]/, (_, n) => {
        celdas = Math.max(celdas, Number(n) + 1);
        return `[${inicio + Number(n)}]`;
      });
    });
    if (inicio + celdas > TAM_MEMORIA) {
      throw new Error(`El programa no cabe en memoria: ${this.codigo.length} celdas de código, ` +
        `${MARGEN_DATOS} de separación y ${celdas} de datos, y solo hay ${TAM_MEMORIA}`);
    }
  }

  guardarResultado(destino) {
    this.codigo.push(`store AC ${this.celdaDatos()}`);
    this.codigo.push(`load ${this.registros[destino]} ${this.celdaDatos()}`);
    this.siguienteDato += 1;
  }

  asignarValor(destino, [tipo, valor]) {
    const reg = this.registros[destino];
    const tipoVar = this.tipoVariables[destino];
    const literal = valor.toLowerCase();

    if (tipo === "CADENA") {
      if (tipoVar !== "caracter") throw new Error(`No se puede asignar texto a '${destino}' (${tipoVar})`);
      const texto = valor.slice(1, -1);
      if ([...texto].length !== 1) throw new Error(`Un carácter debe tener un solo símbolo: ${valor}`);
      this.codigo.push(`load ${reg} #${texto.codePointAt(0)}`);
    } else if (tipo === "NUMERO") {
      const inmediato = tipoVar === "booleano" ? (Number(valor) ? 1 : 0) : valor;
      this.codigo.push(`load ${reg} #${inmediato}`);
    } else if (tipo === "ID" && literal in LITERALES_BOOLEANOS) {
      this.codigo.push(`load ${reg} #${LITERALES_BOOLEANOS[literal]}`);
    } else if (tipo === "ID") {
      // Copia entre variables: no hay instrucción mov, se pasa por memoria.
      const origen = this.registroDe(valor);
      this.codigo.push(`store ${origen} ${this.celdaDatos()}`);
      this.codigo.push(`load ${reg} ${this.celdaDatos()}`);
      this.siguienteDato += 1;
    } else {
      throw new Error(`Valor no válido: ${valor}`);
    }
  }

  asignar(destino, expresion) {
    if (expresion.length === 1) {
      this.nuevaVariable(destino);
      this.asignarValor(destino, expresion[0]);
      return;
    }
    if (expresion.length !== 3) {
      throw new Error("Solo se permiten operaciones binarias, con dos operandos y sin paréntesis");
    }
    const operador = expresion[1][0];
    const instruccion = OP_ARITMETICOS[operador] || OP_RELACIONALES[operador];
    if (!instruccion) throw new Error(`Operador no válido: ${expresion[1][1]}`);
    this.nuevaVariable(destino);
    const r1 = this.operando(expresion[0]);
    const r2 = this.operando(expresion[2]);
    this.codigo.push(`${instruccion} ${r1} ${r2}`);
    this.guardarResultado(destino);
  }

  segundoOperandoComparacion([tipo, valor]) {
    if (tipo === "NUMERO") return `#${valor}`;
    if (tipo === "CADENA") throw new Error("No se permite comparar con caracteres");
    if (tipo === "ID") {
      const literal = valor.toLowerCase();
      if (literal in LITERALES_BOOLEANOS) return `#${LITERALES_BOOLEANOS[literal]}`;
      return this.registroDe(valor);
    }
    throw new Error(`Operando no válido: ${valor}`);
  }

  // tokens[1] es la variable; admite "var", "var op valor" y un "entonces" final.
  condicion(tokens, etiquetaSalida) {
    if (!tokens[1] || tokens[1][0] !== "ID") throw new Error("La condición debe empezar por una variable");
    const reg = this.registroDe(tokens[1][1]);
    let fin = 2;
    if (tokens[2] && tokens[2][0] in SALTO_CONTRARIO) {
      if (!tokens[3]) throw new Error("Falta el valor de la comparación");
      this.codigo.push(`cmp ${reg} ${this.segundoOperandoComparacion(tokens[3])}`);
      this.codigo.push(`${SALTO_CONTRARIO[tokens[2][0]]} ${etiquetaSalida}`);
      fin = 4;
    } else {
      this.codigo.push(`cmp ${reg} #0`);
      this.codigo.push(`je ${etiquetaSalida}`);
    }
    if (tokens[fin] && tokens[fin][1] === "entonces") fin += 1;
    if (tokens.length > fin) throw new Error("Solo se permite una comparación binaria");
  }

  sentenciaPara(tokens) {
    const entero = (token, nombre) => {
      if (!token || token[0] !== "NUMERO" || token[1].includes(".")) {
        throw new Error(`En para, ${nombre} debe ser un número entero`);
      }
      return parseInt(token[1], 10);
    };
    if (!tokens[1] || tokens[1][0] !== "ID" || !tokens[2] || tokens[2][0] !== "ASIGNAR" ||
        !tokens[4] || tokens[4][0] !== "HASTA") {
      throw new Error("Sintaxis: para i := 1 hasta 5 [paso 1]");
    }
    const variable = tokens[1][1];
    const inicio = entero(tokens[3], "el inicio");
    const final = entero(tokens[5], "el final");
    let paso = 1;
    if (tokens[6]) {
      if (tokens[6][0] !== "PASO") throw new Error("Sintaxis: para i := 1 hasta 5 [paso 1]");
      paso = entero(tokens[7], "el paso");
    }
    this.nuevaVariable(variable);
    const reg = this.registros[variable];
    const n = this.contadorEtiquetas++;
    const bucle = `etq_for_${n}`;
    const salida = `etq_finfor_${n}`;
    this.codigo.push(`load ${reg} #${inicio} ;  Inicializa PARA `);
    this.pila.push({ tipo: "para", reg, paso, bucle, salida });
    this.codigo.push(`${bucle}:`);
    this.codigo.push(`cmp ${reg} #${paso > 0 ? final + 1 : final - 1}`);
    this.codigo.push(`${paso > 0 ? "jge" : "jle"} ${salida}`);
  }

  sentenciaFinPara() {
    const bloque = this.pila[this.pila.length - 1];
    if (!bloque || bloque.tipo !== "para") throw new Error("finpara sin para");
    const regPaso = this.constante(bloque.paso, `paso:${bloque.paso}`);
    this.pila.pop();
    this.codigo.push(`add ${bloque.reg} ${regPaso}`);
    this.codigo.push(`store AC ${this.celdaDatos()}`);
    this.codigo.push(`load ${bloque.reg} ${this.celdaDatos()}`);
    this.codigo.push(`jmp ${bloque.bucle}`);
    this.codigo.push(`${bloque.salida}: ; Fin PARA`);
  }

  cerrarSi(bloque) {
    this.pila.pop();
    this.codigo.push(`${bloque.conSino ? bloque.salida : bloque.sino}:`);
  }

  sentenciaImprimir(tokens) {
    const argumentos = [];
    for (const [tipo, valor] of tokens.slice(1)) {
      if (tipo === "COMA") continue;
      if (tipo === "CADENA") {
        const texto = valor.slice(1, -1);
        if (texto.includes('"')) throw new Error("Un texto no puede contener comillas dobles");
        argumentos.push(`"${texto}"`);
      } else if (tipo === "NUMERO") {
        argumentos.push(`"${valor}"`);
      } else if (tipo === "ID") {
        const reg = this.registroDe(valor);
        const prefijo = { caracter: "char", booleano: "bool", real: "float" }[this.tipoVariables[valor]] || "int";
        argumentos.push(`(${prefijo}) ${reg}`);
      } else {
        throw new Error(`No se puede imprimir: ${valor}`);
      }
    }
    if (argumentos.length) this.codigo.push("print " + argumentos.join(" "));
  }

  sentencia(tokens) {
    const [t, v] = tokens[0];
    const cima = this.pila[this.pila.length - 1];

    if (t === "ID" && TIPOS_VARIABLE.includes(v)) {
      if (!tokens[1] || tokens[1][0] !== "ID") throw new Error(`Falta el nombre de la variable tras ${v}`);
      const nombre = tokens[1][1];
      this.nuevaVariable(nombre, v);
      if (tokens[2]) {
        if (tokens[2][0] !== "ASIGNAR") throw new Error("Se esperaba := en la declaración");
        this.asignar(nombre, tokens.slice(3));
      }
    } else if (t === "PARA") {
      this.sentenciaPara(tokens);
    } else if (t === "FINPARA") {
      this.sentenciaFinPara();
    } else if (t === "MIENTRAS") {
      const n = this.contadorEtiquetas++;
      const bloque = { tipo: "mientras", bucle: `etq_loop_${n}`, salida: `etq_fin_${n}` };
      this.pila.push(bloque);
      this.codigo.push(`${bloque.bucle}: ; Inicializa MIENTRAS`);
      this.condicion(tokens, bloque.salida);
    } else if (t === "SI") {
      const n = this.contadorEtiquetas++;
      const bloque = { tipo: "si", sino: `etq_sino_${n}`, salida: `etq_finif_${n}`, conSino: false };
      this.pila.push(bloque);
      this.condicion(tokens, bloque.sino);
    } else if (t === "SINO") {
      if (!cima || cima.tipo !== "si") throw new Error("sino sin si");
      this.codigo.push(`jmp ${cima.salida}`);
      this.codigo.push(`${cima.sino}:`);
      cima.conSino = true;
    } else if (t === "FINSI") {
      if (!cima || cima.tipo !== "si") throw new Error("finsi sin si");
      this.cerrarSi(cima);
    } else if (t === "FIN") {
      // El README cierra si con "fin", así que se admite igual que finsi.
      if (cima && cima.tipo === "si") {
        this.cerrarSi(cima);
      } else if (cima && cima.tipo === "mientras") {
        this.pila.pop();
        this.codigo.push(`jmp ${cima.bucle}`);
        this.codigo.push(`${cima.salida}: ; Fin MIENTRAS`);
      } else {
        throw new Error("fin sin bloque abierto");
      }
    } else if (t === "IMPRIMIR") {
      this.sentenciaImprimir(tokens);
    } else if (t === "ID" && tokens[1] && tokens[1][0] === "ASIGNAR") {
      this.asignar(v, tokens.slice(2));
    } else {
      throw new Error(`Sentencia no reconocida: ${v}`);
    }
  }

  compilar(texto) {
    const lineas = texto.split(/\r?\n/);
    lineas.forEach((linea, indice) => {
      try {
        const tokens = lexer(linea).filter(([tipo]) => tipo !== "COMENTARIO");
        if (tokens.length) this.sentencia(tokens);
      } catch (error) {
        throw new Error(`Línea ${indice + 1}: ${error.message}`);
      }
    });
    if (this.pila.length) {
      const cierre = { si: "finsi", mientras: "fin", para: "finpara" }[this.pila[this.pila.length - 1].tipo];
      throw new Error(`Falta cerrar un bloque con ${cierre}`);
    }
    this.reubicarDatos();
    return this.codigo;
  }

  gramatica(codigoFuente) {
    let salida = "=== TOKENS POR LÍNEA ===\n\n";
    for (const linea of codigoFuente.trim().split(/\r?\n/)) {
      salida += `[${linea.trim()}]\n`;
      for (const [tipo, valor] of lexer(linea)) salida += `   ('${tipo}', '${valor}')\n`;
      salida += "\n";
    }
    return salida;
  }
}
