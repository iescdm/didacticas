"use strict";
// Comandos de consola que generan un programa. Cada uno escribe código fuente
// y lo pasa por el compilador real, así que su ensamblador es el mismo que se
// obtendría escribiendo ese programa en la pestaña Compilador.
// Para añadir uno basta con una entrada más en COMANDOS.

const ComandosShell = (() => {
  const NUMERO = /^-?\d+(?:\.\d+)?$/;
  const ENTERO = /^-?\d+$/;
  const FACTORIAL_MAXIMO = 12; // el resultado debe caber en un registro de 32 bits
  const FIBONACCI_MAXIMO = 40;
  const ENTERO_MAXIMO = 2 ** 31 - 1;
  const BUCLE_MAXIMO = 10000; // por debajo del límite de instrucciones de la máquina

  function tipoDe(numeros) {
    return numeros.some((n) => n.includes(".")) ? "real" : "entero";
  }

  function exigirRango(nombre, valor, minimo, maximo) {
    if (Number(valor) < minimo || Number(valor) > maximo) {
      throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}`);
    }
  }

  function operacion(simbolo, operador, tipo) {
    return (a, b) => {
      const t = tipo || tipoDe([a, b]);
      return `${t} a := ${a}
${t} b := ${b}
${t} r
r := a ${operador} b
imprimir a, "${simbolo}", b, "=", r`;
    };
  }

  const COMANDOS = {
    suma: { uso: "<a> <b>", descripcion: "Suma dos números", argumentos: [NUMERO, NUMERO], fuente: operacion("+", "+") },
    resta: { uso: "<a> <b>", descripcion: "Resta dos números", argumentos: [NUMERO, NUMERO], fuente: operacion("-", "-") },
    multiplica: { uso: "<a> <b>", descripcion: "Multiplica dos números", argumentos: [NUMERO, NUMERO], fuente: operacion("*", "*") },
    divide: { uso: "<a> <b>", descripcion: "Divide dos números", argumentos: [NUMERO, NUMERO], fuente: operacion("/", "/", "real") },
    mayor: {
      uso: "<a> <b>", descripcion: "Indica cuál de dos números es mayor", argumentos: [NUMERO, NUMERO],
      fuente: (a, b) => {
        const t = tipoDe([a, b]);
        return `${t} a := ${a}
${t} b := ${b}
si a > b
    imprimir "El mayor es", a
sino
    imprimir "El mayor es", b
finsi`;
      },
    },
    tabla: {
      uso: "<n>", descripcion: "Tabla de multiplicar de n", argumentos: [ENTERO],
      fuente: (n) => `entero n := ${n}
entero i
entero r
para i := 1 hasta 10
    r := i * n
    imprimir n, "x", i, "=", r
finpara`,
    },
    cuenta: {
      uso: "<desde> <hasta>", descripcion: "Cuenta de un número a otro", argumentos: [ENTERO, ENTERO],
      fuente: (desde, hasta) => `entero i
para i := ${desde} hasta ${hasta} paso ${Number(desde) <= Number(hasta) ? 1 : -1}
    imprimir i
finpara`,
    },
    factorial: {
      uso: "<n>", descripcion: `Factorial de n (de 0 a ${FACTORIAL_MAXIMO})`, argumentos: [ENTERO],
      validar: (n) => exigirRango("n", n, 0, FACTORIAL_MAXIMO),
      fuente: (n) => `entero n := ${n}
entero r := 1
entero i
para i := 2 hasta ${n}
    r := r * i
finpara
imprimir n, "! =", r`,
    },
    potencia: {
      uso: "<base> <exponente>", descripcion: "Eleva un número a una potencia", argumentos: [ENTERO, ENTERO],
      validar: (base, exponente) => {
        if (Number(exponente) < 0) throw new Error("El exponente no puede ser negativo");
        if (Math.abs(Number(base)) ** Number(exponente) > ENTERO_MAXIMO) {
          throw new Error("El resultado no cabe en un registro de 32 bits");
        }
      },
      fuente: (base, exponente) => `entero b := ${base}
entero e := ${exponente}
entero r := 1
entero i
para i := 1 hasta ${exponente}
    r := r * b
finpara
imprimir b, "^", e, "=", r`,
    },
    sumatorio: {
      uso: "<n>", descripcion: "Suma los números de 1 a n", argumentos: [ENTERO],
      validar: (n) => exigirRango("n", n, 1, BUCLE_MAXIMO),
      fuente: (n) => `entero n := ${n}
entero s := 0
entero i
para i := 1 hasta ${n}
    s := s + i
finpara
imprimir "Suma de 1 a", n, "=", s`,
    },
    media: {
      uso: "<a> <b>", descripcion: "Media de dos números", argumentos: [NUMERO, NUMERO],
      fuente: (a, b) => `real a := ${a}
real b := ${b}
real s
real r
s := a + b
r := s / 2
imprimir "Media =", r`,
    },
    absoluto: {
      uso: "<n>", descripcion: "Valor absoluto de un número", argumentos: [NUMERO],
      fuente: (n) => {
        const t = tipoDe([n]);
        return `${t} n := ${n}
${t} r
r := n
si n < 0
    r := 0 - n
finsi
imprimir "El valor absoluto de", n, "es", r`;
      },
    },
    par: {
      uso: "<n>", descripcion: "Indica si un número es par, usando la división entera", argumentos: [ENTERO],
      fuente: (n) => `entero n := ${n}
entero q
entero d
q := n / 2
d := q * 2
si d == n
    imprimir n, "es par"
sino
    imprimir n, "es impar"
finsi`,
    },
    primo: {
      uso: "<n>", descripcion: "Indica si un número es primo, probando divisores", argumentos: [ENTERO],
      validar: (n) => exigirRango("n", n, 0, BUCLE_MAXIMO),
      fuente: (n) => `entero n := ${n}
entero i := 2
entero q
entero p
booleano primo := verdadero
si n < 2
    primo := falso
finsi
mientras i < n
    q := n / i
    p := q * i
    si p == n
        primo := falso
    finsi
    i := i + 1
fin
si primo
    imprimir n, "es primo"
sino
    imprimir n, "no es primo"
finsi`,
    },
    mcd: {
      uso: "<a> <b>", descripcion: "Máximo común divisor, con el algoritmo de Euclides por restas", argumentos: [ENTERO, ENTERO],
      validar: (a, b) => {
        exigirRango("a", a, 1, BUCLE_MAXIMO);
        exigirRango("b", b, 1, BUCLE_MAXIMO);
      },
      fuente: (a, b) => `entero a := ${a}
entero b := ${b}
mientras a != b
    si a > b
        a := a - b
    sino
        b := b - a
    finsi
fin
imprimir "mcd =", a`,
    },
    fibonacci: {
      uso: "<n>", descripcion: "Primeros n términos de la sucesión de Fibonacci", argumentos: [ENTERO],
      validar: (n) => exigirRango("n", n, 1, FIBONACCI_MAXIMO),
      fuente: (n) => `entero a := 0
entero b := 1
entero c
entero i
para i := 1 hasta ${n}
    imprimir a
    c := a + b
    a := b
    b := c
finpara`,
    },
    intercambia: {
      uso: "<a> <b>", descripcion: "Intercambia dos variables con una auxiliar", argumentos: [NUMERO, NUMERO],
      fuente: (a, b) => {
        const t = tipoDe([a, b]);
        return `${t} a := ${a}
${t} b := ${b}
${t} aux
imprimir "Antes:", a, b
aux := a
a := b
b := aux
imprimir "Después:", a, b`;
      },
    },
    ascii: {
      uso: "<carácter>", descripcion: "Código numérico de un carácter", argumentos: null,
      fuente: (caracter) => {
        if ([...caracter].length !== 1) throw new Error("Uso: ascii <carácter>");
        if (caracter === "'") throw new Error("La comilla simple no se puede usar en un carácter");
        return `caracter c := '${caracter}'
entero n
n := c
imprimir c, "tiene el código", n`;
      },
    },
    eco: {
      uso: "<texto>", descripcion: "Escribe un texto", argumentos: null,
      fuente: (texto) => {
        if (!texto) throw new Error("Uso: eco <texto>");
        if (texto.includes('"')) throw new Error("El texto no puede contener comillas dobles");
        return `imprimir "${texto}"`;
      },
    },
  };

  function argumentosDe(comando, nombre, resto) {
    if (!comando.argumentos) return [resto];
    const argumentos = resto ? resto.split(/\s+/) : [];
    const validos = argumentos.length === comando.argumentos.length &&
      argumentos.every((a, i) => comando.argumentos[i].test(a));
    if (!validos) throw new Error(`Uso: ${nombre} ${comando.uso}`);
    return argumentos;
  }

  // Devuelve { fuente, asm }, o null si la línea no es uno de estos comandos.
  function generar(linea) {
    const m = /^\s*(\S+)\s*(.*?)\s*$/.exec(linea);
    if (!m) return null;
    const nombre = m[1].toLowerCase();
    if (!Object.hasOwn(COMANDOS, nombre)) return null;
    const comando = COMANDOS[nombre];
    const argumentos = argumentosDe(comando, nombre, m[2]);
    if (comando.validar) comando.validar(...argumentos);
    const fuente = comando.fuente(...argumentos);
    return { fuente, asm: new Compilador().compilar(fuente).join("\n") };
  }

  function lista() {
    return Object.entries(COMANDOS).map(([nombre, { uso, descripcion }]) => ({ orden: `${nombre} ${uso}`, descripcion }));
  }

  function ayuda() {
    const comandos = lista();
    const ancho = Math.max(...comandos.map(({ orden }) => orden.length));
    const filas = comandos.map(({ orden, descripcion }) => `  ${orden.padEnd(ancho)}  ${descripcion}`);
    return `Comandos que generan un programa:\n${filas.join("\n")}`;
  }

  return { generar, ayuda, lista, nombres: () => Object.keys(COMANDOS) };
})();
