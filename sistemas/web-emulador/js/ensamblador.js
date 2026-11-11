"use strict";
// Ensamblador: ASM (texto) <-> hexadecimal. Versión JavaScript de
// ChipAssembler.py y Assembler_print.py, con el mismo formato binario.
// El único opcode nuevo es jne (0x10).

const Ensamblador = (() => {
  const INSTRUCCIONES = {
    load: 0x01, store: 0x02, add: 0x03, sub: 0x04, mul: 0x05, div: 0x06,
    cmp: 0x07, jmp: 0x08, je: 0x09, jge: 0x0a, jle: 0x0b, print: 0x0c,
    cmplt: 0x0d, label: 0x0e, jl: 0x0f, jne: 0x10, cmple: 0x11, cmpge: 0x12,
    cmpne: 0x13, cmpgt: 0x14, cmpeq: 0x15, jg: 0x1b,
  };
  const NOMBRES = Object.fromEntries(Object.entries(INSTRUCCIONES).map(([k, v]) => [v, k]));
  const SALTOS = ["jmp", "je", "jne", "jg", "jl", "jge", "jle"];
  const AC = 0xff;
  const OFFSET_MEMORIA = 0x4000;
  const OFFSET_INMEDIATO = 0x8000;
  const INMEDIATO_MIN = -0x4000;
  const INMEDIATO_MAX = 0x3fff;
  // En print estos textos son operandos; un literal igual conserva sus comillas.
  const RESERVADO_PRINT = /^(?:[RF][1-9]|\((?:int|float|char|bool)\)|\[\d+\])$/;

  // Quita el comentario ";" respetando los que van dentro de una cadena.
  function quitarComentario(linea) {
    let comilla = null;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (comilla) {
        if (c === comilla) comilla = null;
      } else if (c === '"' || c === "'") {
        comilla = c;
      } else if (c === ";") {
        return linea.slice(0, i).trim();
      }
    }
    return linea.trim();
  }

  function u16(valor) {
    return [valor & 0xff, (valor >> 8) & 0xff];
  }

  function f32(valor) {
    const vista = new DataView(new ArrayBuffer(4));
    vista.setFloat32(0, valor, true);
    return [0, 1, 2, 3].map((i) => vista.getUint8(i));
  }

  function inmediato(n) {
    if (n < INMEDIATO_MIN || n > INMEDIATO_MAX) {
      throw new Error(`Valor inmediato fuera de rango (${INMEDIATO_MIN} a ${INMEDIATO_MAX}): ${n}`);
    }
    return u16(OFFSET_INMEDIATO + (n & 0x7fff));
  }

  function codificarOperando(texto, etiquetas, estricto) {
    let m;
    if ((m = /^R([1-9])$/.exec(texto))) return u16(Number(m[1]));
    if ((m = /^F([1-9])$/.exec(texto))) return u16(0x10 + Number(m[1]));
    if (texto === "AC") return u16(AC);
    if (texto.startsWith("#")) {
      const numero = texto.slice(1);
      if (numero.includes(".")) return f32(parseFloat(numero));
      if (!/^[+-]?\d+$/.test(numero)) throw new Error(`Valor inmediato no válido: ${texto}`);
      return inmediato(parseInt(numero, 10));
    }
    if ((m = /^\[(\d+)\]$/.exec(texto))) return u16(OFFSET_MEMORIA + Number(m[1]));
    if (/^\d+$/.test(texto)) return inmediato(parseInt(texto, 10));
    if (texto in etiquetas) return inmediato(etiquetas[texto]);
    if (!estricto) return u16(0);
    throw new Error(`Etiqueta u operando desconocido: ${texto}`);
  }

  function codificarPrint(linea) {
    const bytes = [INSTRUCCIONES.print];
    const argumentos = linea.slice(5).match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (const argumento of argumentos) {
      let texto = argumento;
      if (/^(["']).*\1$/.test(argumento)) {
        const interior = argumento.slice(1, -1);
        texto = RESERVADO_PRINT.test(interior) ? `"${interior}"` : interior;
      }
      const datos = new TextEncoder().encode(texto);
      if (datos.length > 255) throw new Error("Texto demasiado largo en print (máximo 255 bytes)");
      bytes.push(datos.length, ...datos);
    }
    return bytes;
  }

  function codificarInstruccion(linea, etiquetas, estricto) {
    const partes = linea.split(/\s+/);
    const opcode = partes[0];
    if (!(opcode in INSTRUCCIONES)) throw new Error(`Instrucción desconocida: ${opcode}`);
    if (opcode === "print") return codificarPrint(linea);
    const bytes = [INSTRUCCIONES[opcode]];
    for (const operando of partes.slice(1)) bytes.push(...codificarOperando(operando, etiquetas, estricto));
    return bytes;
  }

  function codificarPrograma(programa) {
    const lineas = programa.split(/\r?\n/).map(quitarComentario).filter(Boolean);

    // Primera pasada: posición en bytes de cada etiqueta.
    const etiquetas = {};
    let offset = 0;
    for (const linea of lineas) {
      if (linea.endsWith(":")) etiquetas[linea.slice(0, -1)] = offset;
      else offset += codificarInstruccion(linea, {}, false).length;
    }

    // Segunda pasada: codificar con las etiquetas ya resueltas.
    return lineas.map((linea) => (linea.endsWith(":")
      ? codificarInstruccion(`label ${etiquetas[linea.slice(0, -1)]}`, etiquetas, true)
      : codificarInstruccion(linea, etiquetas, true)));
  }

  function bloqueAHex(bloque) {
    return bloque.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  }

  function asmAHex(programa) {
    return codificarPrograma(programa.trim()).map(bloqueAHex).join("\n");
  }

  // El número más corto que, guardado en 32 bits, devuelve el mismo valor.
  function formatoReal(valor) {
    for (let precision = 1; precision <= 9; precision++) {
      const candidato = Number(valor.toPrecision(precision));
      if (Math.fround(candidato) === valor) {
        const texto = String(candidato);
        return texto.includes(".") ? texto : `${texto}.0`;
      }
    }
    return String(valor);
  }

  function decodificarOperando(valor) {
    if (valor >= 1 && valor <= 9) return `R${valor}`;
    if (valor >= 0x11 && valor <= 0x19) return `F${valor - 0x10}`;
    if (valor === AC) return "AC";
    if (valor >= OFFSET_INMEDIATO) {
      const n = valor - OFFSET_INMEDIATO;
      return `#${n >= 0x4000 ? n - 0x8000 : n}`;
    }
    if (valor >= OFFSET_MEMORIA) return `[${valor - OFFSET_MEMORIA}]`;
    return `UNKNOWN(${valor})`;
  }

  function decodificarPrint(bytes) {
    const argumentos = [];
    let i = 1;
    while (i < bytes.length) {
      const longitud = bytes[i];
      if (i + 1 + longitud > bytes.length) break;
      const texto = new TextDecoder().decode(Uint8Array.from(bytes.slice(i + 1, i + 1 + longitud)));
      const conComillas = texto.length >= 2 && texto.startsWith('"') && texto.endsWith('"');
      argumentos.push(RESERVADO_PRINT.test(texto) || conComillas ? texto : `"${texto}"`);
      i += 1 + longitud;
    }
    return `print ${argumentos.join(" ")}`;
  }

  function decodificarInstruccion(bytes) {
    const nombre = NOMBRES[bytes[0]];
    if (!nombre) return `UNKNOWN(${bytes[0]})`;
    if (nombre === "print") return decodificarPrint(bytes);

    const vista = new DataView(Uint8Array.from(bytes).buffer);
    const operandos = [];
    let i = 1;
    while (i + 2 <= bytes.length) {
      if (bytes.length - i === 4 && i > 1) {
        operandos.push(`#${formatoReal(vista.getFloat32(i, true))}`);
        i += 4;
      } else {
        operandos.push(decodificarOperando(vista.getUint16(i, true)));
        i += 2;
      }
    }
    const destino = operandos.join("").replace("#", "");
    if (nombre === "label") return `label_${destino}:`;
    if (SALTOS.includes(nombre)) return `${nombre} label_${destino}`;
    return `${nombre} ${operandos.join(" ")}`;
  }

  function esHex(texto) {
    return /^[0-9A-Fa-f]{2}(?: [0-9A-Fa-f]{2})*$/.test(texto);
  }

  function hexAAsm(linea) {
    return decodificarInstruccion(linea.trim().split(/\s+/).map((b) => parseInt(b, 16)));
  }

  function opcode(nombre) {
    return INSTRUCCIONES[nombre];
  }

  return { asmAHex, hexAAsm, esHex, quitarComentario, opcode };
})();
