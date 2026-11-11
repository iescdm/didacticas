"use strict";
// Desglosa una instrucción en los micropasos del ciclo captación-decodificación-
// ejecución. No toca el DOM ni la máquina: ejecuta la instrucción en una copia y
// toma de ella los resultados, así que lo que se enseña es lo que hace la máquina.

const OPERACIONES_ALU = {
  add: { simbolo: "+", nombre: "suma" },
  sub: { simbolo: "−", nombre: "resta" },
  mul: { simbolo: "×", nombre: "multiplicación" },
  div: { simbolo: "÷", nombre: "división" },
};
const SIMBOLOS_COMPARACION = { cmplt: "<", cmpgt: ">", cmple: "≤", cmpge: "≥", cmpeq: "=", cmpne: "≠" };
const CONDICIONES_SALTO = {
  jmp: "siempre", je: "SR = 0", jne: "SR ≠ 0", jg: "SR > 0", jl: "SR < 0", jge: "SR ≥ 0", jle: "SR ≤ 0",
};

function numeroLegible(valor) {
  return Number.isInteger(valor) ? String(valor) : String(Number(valor.toPrecision(6)));
}

// Registros que se dibujan, con los valores de la máquina en este momento.
function vistaInicial(maquina) {
  const { PC, IR, SR, MAR, AC, ACreal, ultimoDato } = maquina;
  return { PC, IR, SR, MAR, AC, ACreal, ultimoDato, R: [...maquina.R], F: [...maquina.F], memoria: [...maquina.memoria] };
}

function aplicarCambios(vista, cambios) {
  for (const [clave, valor] of Object.entries(cambios)) {
    const m = /^([RFM])(\d+)$/.exec(clave);
    if (!m) vista[clave] = valor;
    else if (m[1] === "M") vista.memoria[Number(m[2])] = valor;
    else vista[m[1]][Number(m[2]) - 1] = valor;
  }
}

function copiaDeMaquina(maquina, escribir) {
  const copia = new Maquina(escribir);
  copia.importar(JSON.parse(JSON.stringify(maquina.exportar())));
  return copia;
}

function leerOperando(maquina, texto) {
  if (texto.startsWith("#")) {
    return { nodo: "IR", nombre: texto.slice(1), valor: maquina.inmediato(texto.slice(1)).valor };
  }
  const reg = maquina.registro(texto);
  return { nodo: "BANCO", nombre: texto.toUpperCase(), valor: maquina.leer(reg) };
}

function pasosCaptacion(direccion, instruccion) {
  const fase = "Captación";
  return [
    {
      fase, rtl: "MAR ← PC",
      texto: `PC contiene la dirección de la próxima instrucción (${direccion}). Se copia en MAR, el registro que apunta a la memoria.`,
      movimientos: [{ de: "PC", a: "MAR", valor: direccion, bus: "datos" }],
      activos: ["PC", "MAR"], cambios: { MAR: direccion },
    },
    {
      fase, rtl: "IR ← M[MAR]",
      texto: `MAR envía la dirección ${direccion} por el bus de direcciones. La memoria devuelve la instrucción por el bus de datos y se guarda en IR.`,
      movimientos: [
        { de: "MAR", a: "MEM", valor: direccion, bus: "direcciones" },
        { de: "MEM", a: "IR", valor: instruccion, bus: "datos" },
      ],
      activos: ["MAR", "MEM", "IR"], cambios: { IR: instruccion },
    },
    {
      fase, rtl: "PC ← PC + 1",
      texto: `PC se incrementa a ${direccion + 1} para apuntar a la instrucción siguiente, antes de ejecutar la actual.`,
      movimientos: [], activos: ["PC"], cambios: { PC: direccion + 1 },
    },
  ];
}

function textoDecodificacion(nombre, partes, esEtiqueta) {
  if (esEtiqueta) return "Es una etiqueta: solo marca una posición del programa, no hay nada que calcular.";
  const opcode = Ensamblador.opcode(nombre);
  const codigo = opcode === undefined ? "" : ` (opcode 0x${opcode.toString(16).toUpperCase().padStart(2, "0")})`;
  const inicio = `La unidad de control reconoce ${nombre}${codigo}`;
  if (nombre in OPERACIONES_ALU) return `${inicio}: la ALU hará una ${OPERACIONES_ALU[nombre].nombre} con ${partes[1]} y ${partes[2]}.`;
  if (nombre === "cmp") return `${inicio}: la ALU comparará ${partes[1]} y ${partes[2]} y el resultado irá a SR.`;
  if (nombre in SIMBOLOS_COMPARACION) return `${inicio}: la ALU comprobará ${partes[1]} ${SIMBOLOS_COMPARACION[nombre]} ${partes[2]} y dejará 1 o 0 en AC.`;
  if (nombre in CONDICIONES_SALTO) return `${inicio}: es un salto a ${partes[1]}, con condición: ${CONDICIONES_SALTO[nombre]}.`;
  if (nombre === "load") return `${inicio}: hay que cargar el registro ${partes[1]}.`;
  if (nombre === "store") return `${inicio}: hay que escribir en la memoria.`;
  if (nombre === "print") return `${inicio}: hay que enviar datos a la salida.`;
  return `${inicio}.`;
}

function pasosLoad(maquina, copia, partes) {
  const destino = partes[1].toUpperCase();
  const reg = copia.registro(destino);
  const valor = copia.leer(reg);
  if (partes[2].startsWith("#")) {
    return [{
      rtl: `${destino} ← ${numeroLegible(valor)}`,
      texto: `El valor ${numeroLegible(valor)} va dentro de la propia instrucción, así que pasa de IR al registro ${destino} sin acceder a la memoria.`,
      movimientos: [{ de: "IR", a: "BANCO", valor: numeroLegible(valor), bus: "datos" }],
      activos: ["IR", destino], cambios: { [destino]: valor },
    }];
  }
  const direccion = maquina.direccion(partes[2]);
  return [
    {
      rtl: `MAR ← ${direccion}`, texto: `La dirección ${direccion} sale de IR y se copia en MAR.`,
      movimientos: [{ de: "IR", a: "MAR", valor: direccion, bus: "datos" }],
      activos: ["IR", "MAR"], cambios: { MAR: direccion, ultimoDato: direccion },
    },
    {
      rtl: `${destino} ← M[MAR]`,
      texto: `La memoria entrega el contenido de la celda ${direccion} (${numeroLegible(valor)}) y se guarda en ${destino}.`,
      movimientos: [
        { de: "MAR", a: "MEM", valor: direccion, bus: "direcciones" },
        { de: "MEM", a: "BANCO", valor: numeroLegible(valor), bus: "datos" },
      ],
      activos: ["MAR", "MEM", destino], cambios: { [destino]: valor },
    },
  ];
}

function pasosStore(maquina, copia, partes) {
  const direccion = maquina.direccion(partes[2]);
  const origen = partes[1].toUpperCase();
  const celda = copia.memoria[direccion];
  let nodo = "BANCO";
  if (origen === "AC") nodo = "AC";
  else if (origen.startsWith("#")) nodo = "IR";
  const valor = numeroLegible(celda.valor);
  return [
    {
      rtl: `MAR ← ${direccion}`, texto: `La dirección ${direccion} sale de IR y se copia en MAR.`,
      movimientos: [{ de: "IR", a: "MAR", valor: direccion, bus: "datos" }],
      activos: ["IR", "MAR"], cambios: { MAR: direccion, ultimoDato: direccion },
    },
    {
      rtl: `M[MAR] ← ${origen}`,
      texto: `El valor ${valor} viaja por el bus de datos y se escribe en la celda ${direccion}.`,
      movimientos: [
        { de: "MAR", a: "MEM", valor: direccion, bus: "direcciones" },
        { de: nodo, a: "MEM", valor, bus: "datos" },
      ],
      activos: [nodo === "BANCO" ? origen : nodo, "MAR", "MEM"], cambios: { [`M${direccion}`]: celda },
    },
  ];
}

function pasosEntradasAlu(a, b) {
  const entrada = (letra, operando) => ({
    rtl: `${letra} ← ${operando.nombre}`,
    texto: `El valor ${numeroLegible(operando.valor)} llega a la entrada ${letra} de la ALU.`,
    movimientos: [{ de: operando.nodo, a: letra, valor: numeroLegible(operando.valor), bus: "datos" }],
    activos: [operando.nodo === "IR" ? "IR" : operando.nombre, letra],
    cambios: { [letra]: operando.valor },
  });
  return [entrada("A", a), entrada("B", b)];
}

function pasosAlu(maquina, copia, partes) {
  const nombre = partes[0];
  const a = leerOperando(maquina, partes[1]);
  const b = leerOperando(maquina, partes[2]);
  const x = numeroLegible(a.valor);
  const y = numeroLegible(b.valor);
  const entradas = pasosEntradasAlu(a, b);

  if (nombre === "cmp") {
    const relacion = { "-1": "A es menor que B", 0: "A y B son iguales", 1: "A es mayor que B" }[copia.SR];
    return [...entradas, {
      rtl: "SR ← compara(A, B)",
      texto: `La ALU calcula ${x} − ${y} y solo guarda el signo: ${relacion}, así que SR = ${copia.SR}.`,
      movimientos: [
        { de: "UC", a: "ALU", valor: "comparar", bus: "control" },
        { de: "ALU", a: "SR", valor: copia.SR, bus: "control" },
      ],
      activos: ["UC", "ALU", "SR"], cambios: { SR: copia.SR, operacion: "compara" },
    }];
  }

  const comparacion = SIMBOLOS_COMPARACION[nombre];
  const simbolo = comparacion || OPERACIONES_ALU[nombre].simbolo;
  const resultado = numeroLegible(copia.AC);
  const texto = comparacion
    ? `¿${x} ${comparacion} ${y}? La ALU deja ${copia.AC ? "1 (verdadero)" : "0 (falso)"} en AC.`
    : `La ALU calcula ${x} ${simbolo} ${y} = ${resultado} y deja el resultado en AC.`;
  return [...entradas, {
    rtl: comparacion ? `AC ← A ${simbolo} B` : `AC ← A ${simbolo} B`, texto,
    movimientos: [
      { de: "UC", a: "ALU", valor: comparacion ? "comparar" : OPERACIONES_ALU[nombre].nombre, bus: "control" },
      { de: "ALU", a: "AC", valor: resultado, bus: "datos" },
    ],
    activos: ["UC", "ALU", "AC"], cambios: { AC: copia.AC, ACreal: copia.ACreal, operacion: simbolo },
  }];
}

function pasosSalto(maquina, copia, partes) {
  const nombre = partes[0];
  const destino = partes[1];
  const salta = CONDICION_SALTO[nombre](maquina.SR);
  const condicion = nombre === "jmp"
    ? "Es un salto incondicional."
    : `La condición es ${CONDICIONES_SALTO[nombre]} y SR vale ${maquina.SR}: ${salta ? "se cumple" : "no se cumple"}.`;
  if (!salta) {
    return [{
      rtl: "PC sin cambios",
      texto: `${condicion} No se salta y PC sigue en ${copia.PC}.`,
      movimientos: [], activos: ["SR", "UC", "PC"], cambios: {},
    }];
  }
  return [{
    rtl: `PC ← ${copia.PC}`,
    texto: `${condicion} PC toma la celda siguiente a la etiqueta ${destino}, que es la ${copia.PC}.`,
    movimientos: [{ de: "IR", a: "PC", valor: copia.PC, bus: "datos" }],
    activos: ["SR", "UC", "IR", "PC"], cambios: { PC: copia.PC },
  }];
}

function pasosPrint(texto, instruccion) {
  const conRegistros = /\b[RF]\d+\b/.test(instruccion.replace(/"[^"]*"/g, ""));
  return [{
    rtl: "Salida ← datos",
    texto: `Se envía a la salida: ${texto}`,
    movimientos: [{ de: conRegistros ? "BANCO" : "IR", a: "ES", valor: texto, bus: "datos" }],
    activos: ["ES"], cambios: { salida: texto },
  }];
}

function pasosEjecucion(maquina, copia, partes, instruccion, textoSalida) {
  const nombre = partes[0];
  if (nombre === "load") return pasosLoad(maquina, copia, partes);
  if (nombre === "store") return pasosStore(maquina, copia, partes);
  if (nombre in OPERACIONES_ALU || nombre in SIMBOLOS_COMPARACION || nombre === "cmp") {
    return pasosAlu(maquina, copia, partes);
  }
  if (nombre in CONDICIONES_SALTO) return pasosSalto(maquina, copia, partes);
  if (nombre === "print") return pasosPrint(textoSalida, instruccion);
  return [];
}

// Micropasos de la instrucción que indica PC. Devuelve null si no hay ninguna.
function trazarCiclo(maquina) {
  const direccion = maquina.PC;
  if (direccion >= maquina.SIZE) return null;
  const celda = maquina.memoria[direccion];
  if (celda.tipo !== "instruccion") return null;

  const instruccion = celda.valor;
  const mensajes = [];
  const copia = copiaDeMaquina(maquina, (tipo, texto) => mensajes.push({ tipo, texto }));
  copia.debug = false;
  copia.paso();

  const error = mensajes.find((m) => m.tipo === "error");
  const salida = mensajes.find((m) => m.tipo === "salida");
  const partes = instruccion.split(/\s+/);
  partes[0] = partes[0].toLowerCase();
  const esEtiqueta = instruccion.endsWith(":");

  const pasos = pasosCaptacion(direccion, instruccion);
  pasos.push({
    fase: "Decodificación", rtl: "Decodificar IR",
    texto: textoDecodificacion(partes[0], partes, esEtiqueta),
    movimientos: [{ de: "IR", a: "UC", valor: partes[0], bus: "control" }],
    activos: ["IR", "UC"], cambios: {},
  });

  let ejecucion;
  if (error) {
    ejecucion = [{
      rtl: "Error", texto: error.texto, error: true,
      movimientos: [], activos: ["UC"], cambios: { PC: copia.PC },
    }];
  } else if (esEtiqueta) {
    ejecucion = [];
  } else {
    ejecucion = pasosEjecucion(maquina, copia, partes, instruccion, salida ? salida.texto : "");
  }
  for (const paso of ejecucion) pasos.push({ fase: "Ejecución", ...paso });

  return { direccion, instruccion, pasos };
}
