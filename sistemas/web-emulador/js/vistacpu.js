"use strict";
// Pestaña CPU: dibuja la máquina y anima los micropasos de ciclo.js. La
// instrucción solo se ejecuta de verdad al acabar su último micropaso, así que
// abandonar un ciclo a medias nunca deja la máquina en un estado intermedio.

const VistaCPU = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const Y_BUS = 265;
  const DURACIONES_MS = [1500, 1000, 650, 380, 180];
  const FILAS_ZONA = 5;
  const REGISTROS_POR_BANCO = 10;

  // Tramos desde cada componente hasta el bus de datos.
  const TRAMOS = {
    PC: [[60, 92], [48, 92], [48, Y_BUS]],
    IR: [[340, 165], [362, 165], [362, Y_BUS]],
    A: [[445, 245], [445, Y_BUS]],
    B: [[595, 245], [595, Y_BUS]],
    AC: [[590, 85], [660, 85], [660, Y_BUS]],
    MAR: [[730, 174], [730, Y_BUS]],
    BANCO: [[415, 300], [415, Y_BUS]],
    MEM: [[850, Y_BUS]],
    ES: [[850, 495], [820, 495], [820, Y_BUS]],
  };
  // Conexiones directas, que no pasan por el bus de datos.
  const DIRECTAS = {
    "MAR>MEM": { puntos: [[780, 152], [850, 152]], bus: "direcciones" },
    "IR>UC": { puntos: [[200, 174], [200, 190]], bus: "control" },
    "UC>ALU": { puntos: [[340, 215], [372, 215], [372, 180], [389, 180]], bus: "control" },
    "ALU>SR": { puntos: [[417, 150], [352, 150], [352, 92], [340, 92]], bus: "control" },
    "ALU>AC": { puntos: [[520, 125], [520, 105]], bus: "datos" },
  };

  let ciclo = null;
  let indice = 0;
  let vista = null;
  let salidaMostrada = "";
  let entradaA = "";
  let entradaB = "";
  let operacion = "";
  let ocupado = false;
  let reproduciendo = false;
  let turno = 0;

  const elemento = (id) => document.getElementById(id);

  function truncar(texto, maximo) {
    const cadena = String(texto);
    return cadena.length > maximo ? `${cadena.slice(0, maximo - 1)}…` : cadena;
  }

  function valorLegible(valor) {
    return typeof valor === "number" ? numeroLegible(valor) : String(valor);
  }

  function linea(puntos, clase) {
    return `<polyline class="${clase}" points="${puntos.map((p) => p.join(",")).join(" ")}"/>`;
  }

  function caja(id, x, y, ancho, alto, etiqueta) {
    return `<g id="cpu-nodo-${id}" class="nodo">
      <rect x="${x}" y="${y}" width="${ancho}" height="${alto}" rx="4"/>
      <text class="etiqueta" x="${x + 8}" y="${y + 14}">${etiqueta}</text>
      <text id="cpu-valor-${id}" class="valor" x="${x + ancho / 2}" y="${y + alto - 9}" text-anchor="middle"></text>
    </g>`;
  }

  function bancoRegistros(letra, y) {
    let html = "";
    for (let i = 0; i < REGISTROS_POR_BANCO; i++) {
      html += caja(`${letra}${i + 1}`, 48 + i * 72, y, 66, 48, `${letra}${i + 1}`);
    }
    return html;
  }

  function filasMemoria(zona, yInicial) {
    let html = "";
    for (let i = 0; i < FILAS_ZONA; i++) {
      const y = yInicial + i * 30;
      html += `<g id="cpu-fila-${zona}-${i}" class="fila">
        <rect x="858" y="${y}" width="214" height="27" rx="3"/>
        <text id="cpu-fila-${zona}-dir-${i}" class="direccion" x="866" y="${y + 18}"></text>
        <text id="cpu-fila-${zona}-valor-${i}" class="contenido" x="900" y="${y + 18}"></text>
      </g>`;
    }
    return html;
  }

  function construir() {
    const tramos = Object.values(TRAMOS).map((t) => linea(t, "bus bus-datos")).join("");
    const directas = Object.values(DIRECTAS).map((d) => linea(d.puntos, `bus bus-${d.bus}`)).join("");
    elemento("cpu-esquema").innerHTML = `
      <rect class="contorno" x="20" y="24" width="770" height="480" rx="8"/>
      <text class="titulo-bloque" x="34" y="44">CPU</text>
      ${linea([[48, Y_BUS], [850, Y_BUS]], "bus bus-datos bus-principal")}
      ${tramos}${directas}
      <text class="nombre-bus" x="480" y="${Y_BUS - 6}">bus de datos</text>
      <text class="nombre-bus" x="786" y="132">bus de</text>
      <text class="nombre-bus" x="786" y="146">direcciones</text>

      ${caja("PC", 60, 70, 120, 44, "PC")}
      ${caja("SR", 200, 70, 140, 44, "SR · estado")}
      ${caja("IR", 60, 130, 280, 44, "IR · instrucción")}
      ${caja("UC", 60, 190, 280, 50, "Unidad de control")}

      ${caja("AC", 450, 65, 140, 40, "AC")}
      <g id="cpu-nodo-ALU" class="nodo">
        <polygon points="380,190 660,190 600,125 440,125"/>
        <text class="etiqueta" x="520" y="146" text-anchor="middle">ALU</text>
        <text id="cpu-valor-ALU" class="valor grande" x="520" y="176" text-anchor="middle"></text>
      </g>
      ${caja("A", 380, 205, 130, 40, "A")}
      ${caja("B", 530, 205, 130, 40, "B")}
      ${caja("MAR", 680, 130, 100, 44, "MAR")}

      <g id="cpu-nodo-BANCO" class="nodo">
        <rect x="40" y="300" width="730" height="186" rx="4"/>
        <text class="etiqueta" x="48" y="318">Registros enteros</text>
        <text class="etiqueta" x="48" y="418">Registros reales</text>
      </g>
      ${bancoRegistros("R", 326)}
      ${bancoRegistros("F", 426)}

      <g id="cpu-nodo-MEM" class="nodo">
        <rect x="850" y="50" width="230" height="380" rx="4"/>
        <text class="etiqueta" x="860" y="68">Memoria · Programa</text>
        <text class="etiqueta" x="860" y="254">Memoria · Datos</text>
      </g>
      ${filasMemoria("programa", 76)}
      ${filasMemoria("datos", 262)}

      <g id="cpu-nodo-ES" class="nodo">
        <rect x="850" y="450" width="230" height="90" rx="4"/>
        <text class="etiqueta" x="860" y="468">Salida</text>
        <text id="cpu-valor-ES" class="valor" x="965" y="505" text-anchor="middle"></text>
      </g>

      <polyline id="cpu-ruta" class="ruta" points=""/>
      <g id="cpu-paquete" class="paquete" visibility="hidden">
        <rect id="cpu-paquete-fondo" rx="4" height="22"/>
        <text id="cpu-paquete-texto" text-anchor="middle" y="15"></text>
      </g>`;
  }

  function puntosDeRuta(movimiento) {
    const directa = DIRECTAS[`${movimiento.de}>${movimiento.a}`];
    if (directa) return directa.puntos;
    if (movimiento.de === "MEM" && movimiento.bus === "direcciones") return DIRECTAS["MAR>MEM"].puntos;
    return [...TRAMOS[movimiento.de], ...[...TRAMOS[movimiento.a]].reverse()];
  }

  function puntoEn(puntos, fraccion) {
    const tramos = puntos.slice(1).map((p, i) => Math.hypot(p[0] - puntos[i][0], p[1] - puntos[i][1]));
    let restante = tramos.reduce((a, b) => a + b, 0) * fraccion;
    for (let i = 0; i < tramos.length; i++) {
      if (restante <= tramos[i] && tramos[i] > 0) {
        const t = restante / tramos[i];
        return [
          puntos[i][0] + (puntos[i + 1][0] - puntos[i][0]) * t,
          puntos[i][1] + (puntos[i + 1][1] - puntos[i][1]) * t,
        ];
      }
      restante -= tramos[i];
    }
    return puntos[puntos.length - 1];
  }

  function duracion() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
    return DURACIONES_MS[Number(elemento("cpu-velocidad").value) - 1];
  }

  function ocultarPaquete() {
    elemento("cpu-paquete").setAttribute("visibility", "hidden");
    elemento("cpu-ruta").setAttribute("points", "");
  }

  // Devuelve false si la animación se ha cancelado.
  function animar(movimiento, miTurno) {
    const puntos = puntosDeRuta(movimiento);
    const texto = truncar(valorLegible(movimiento.valor), 22);
    const anchoPaquete = 12 + texto.length * 7.6;
    const paquete = elemento("cpu-paquete");
    paquete.setAttribute("class", `paquete paquete-${movimiento.bus}`);
    paquete.setAttribute("visibility", "visible");
    elemento("cpu-paquete-texto").textContent = texto;
    elemento("cpu-paquete-texto").setAttribute("x", anchoPaquete / 2);
    elemento("cpu-paquete-fondo").setAttribute("width", anchoPaquete);
    const ruta = elemento("cpu-ruta");
    ruta.setAttribute("class", `ruta ruta-${movimiento.bus}`);
    ruta.setAttribute("points", puntos.map((p) => p.join(",")).join(" "));

    const total = duracion();
    return new Promise((resolver) => {
      const inicio = performance.now();
      const fotograma = (ahora) => {
        if (miTurno !== turno) return resolver(false);
        const fraccion = total ? Math.min(1, (ahora - inicio) / total) : 1;
        const [x, y] = puntoEn(puntos, fraccion);
        paquete.setAttribute("transform", `translate(${x - anchoPaquete / 2} ${y - 11})`);
        if (fraccion < 1) return requestAnimationFrame(fotograma);
        ocultarPaquete();
        return resolver(true);
      };
      requestAnimationFrame(fotograma);
    });
  }

  function pausa(miTurno) {
    return new Promise((resolver) => {
      setTimeout(() => resolver(miTurno === turno), duracion());
    });
  }

  function ponerValor(id, valor, maximo = 9) {
    elemento(`cpu-valor-${id}`).textContent = truncar(valor, maximo);
  }

  function pintarZona(zona, foco, claseFoco) {
    const inicio = Math.max(0, Math.min(TAM_MEMORIA - FILAS_ZONA, foco - Math.floor(FILAS_ZONA / 2)));
    for (let i = 0; i < FILAS_ZONA; i++) {
      const direccion = inicio + i;
      const celda = vista.memoria[direccion];
      elemento(`cpu-fila-${zona}-dir-${i}`).textContent = direccion;
      elemento(`cpu-fila-${zona}-valor-${i}`).textContent =
        celda.tipo === "vacio" ? "" : truncar(valorLegible(celda.valor), 23);
      elemento(`cpu-fila-${zona}-${i}`).setAttribute("class", direccion === foco ? `fila ${claseFoco}` : "fila");
    }
  }

  function pintarMemoria() {
    const enCurso = ciclo ? ciclo.direccion : maquina.ejecutada ?? maquina.PC;
    pintarZona("programa", enCurso, "apuntada");
    const dato = vista.ultimoDato;
    // Sin accesos todavía, la ventana empieza justo después del programa.
    pintarZona("datos", dato ?? maquina.SIZE + Math.floor(FILAS_ZONA / 2), dato === null ? "" : "dato");
  }

  function pintarEsquema() {
    ponerValor("PC", vista.PC);
    ponerValor("SR", vista.SR);
    ponerValor("MAR", vista.MAR);
    ponerValor("AC", valorLegible(vista.AC), 14);
    ponerValor("IR", vista.IR, 34);
    ponerValor("A", valorLegible(entradaA), 12);
    ponerValor("B", valorLegible(entradaB), 12);
    ponerValor("ALU", operacion, 10);
    ponerValor("ES", salidaMostrada, 27);
    ponerValor("UC", ciclo ? ciclo.pasos[Math.min(indice, ciclo.pasos.length - 1)].fase : "En espera", 30);
    for (let i = 0; i < REGISTROS_POR_BANCO; i++) {
      ponerValor(`R${i + 1}`, vista.R[i], 8);
      ponerValor(`F${i + 1}`, valorLegible(vista.F[i]), 8);
    }
    pintarMemoria();
  }

  function marcarActivos(activos) {
    for (const nodo of elemento("cpu-esquema").querySelectorAll(".nodo")) {
      nodo.classList.toggle("activo", activos.includes(nodo.id.replace("cpu-nodo-", "")));
    }
  }

  function pintarFases(fase) {
    for (const chip of elemento("cpu-fases").children) {
      chip.classList.toggle("activa", chip.dataset.fase === fase);
    }
  }

  function pintarLista() {
    const lista = elemento("cpu-lista");
    lista.innerHTML = "";
    if (!ciclo) return;
    ciclo.pasos.forEach((paso, i) => {
      const item = document.createElement("li");
      item.textContent = paso.rtl;
      if (i < indice) item.className = "hecho";
      if (i === indice) item.className = "actual";
      lista.append(item);
    });
  }

  function explicar(rtl, texto, error = false) {
    elemento("cpu-rtl").textContent = rtl;
    elemento("cpu-rtl").classList.toggle("error", error);
    elemento("cpu-texto").textContent = texto;
  }

  function explicarSiguiente() {
    const titulo = elemento("cpu-instruccion-actual");
    if (!maquina.SIZE) {
      titulo.textContent = "Sin programa";
      explicar("", "Compila un programa y pulsa Cargar en el emulador para ver cómo lo ejecuta la CPU.");
    } else if (maquina.terminado) {
      titulo.textContent = "Programa terminado";
      explicar("", "Pulsa Siguiente micropaso para empezar de nuevo desde la celda 0.");
    } else {
      titulo.textContent = `Celda ${maquina.PC}: ${maquina.memoria[maquina.PC].valor}`;
      explicar("", "Pulsa Siguiente micropaso para ver cómo la CPU ejecuta esta instrucción.");
    }
  }

  function actualizarBotones() {
    elemento("cpu-reproducir").textContent = reproduciendo ? "Pausa" : "Reproducir";
    elemento("cpu-micro").disabled = ocupado;
    elemento("cpu-instruccion").disabled = ocupado;
  }

  function detener() {
    turno += 1;
    ocupado = false;
    reproduciendo = false;
    ocultarPaquete();
    actualizarBotones();
  }

  function refrescarDesdeMaquina() {
    vista = vistaInicial(maquina);
    if (maquina.ejecutada === null) {
      entradaA = "";
      entradaB = "";
      operacion = "";
      salidaMostrada = "";
    }
    marcarActivos([]);
    pintarFases(null);
    pintarEsquema();
  }

  // La máquina ha cambiado desde otra pestaña o al acabar un ciclo.
  function sincronizar() {
    if (ciclo) {
      ciclo = null;
      detener();
      pintarLista();
    }
    refrescarDesdeMaquina();
    if (!ocupado) explicarSiguiente();
  }

  function confirmarInstruccion() {
    ciclo = null;
    anterior = capturarEstado();
    huboError = false;
    maquina.paso();
    if (maquina.terminado && !huboError) escribir("ok", "Programa finalizado");
    pintar();
  }

  function aplicarPaso(paso) {
    const { A, B, operacion: op, salida, ...cambios } = paso.cambios;
    if (A !== undefined) entradaA = A;
    if (B !== undefined) entradaB = B;
    if (op !== undefined) operacion = op;
    if (salida !== undefined) salidaMostrada = salida;
    aplicarCambios(vista, cambios);
  }

  // Avanza un micropaso. Devuelve false si se ha cancelado o no se puede seguir.
  async function avanzar(miTurno, conPausa) {
    if (!ciclo) {
      if (!maquina.SIZE) return false;
      if (maquina.terminado) {
        maquina.reiniciar();
        anterior = null;
        escribir("info", "Programa reiniciado");
        pintar();
      }
      ciclo = trazarCiclo(maquina);
      if (!ciclo) {
        explicar("Error", `La celda ${maquina.PC} no contiene una instrucción.`, true);
        return false;
      }
      vista = vistaInicial(maquina);
      indice = 0;
      elemento("cpu-instruccion-actual").textContent = `Celda ${ciclo.direccion}: ${ciclo.instruccion}`;
    }

    const paso = ciclo.pasos[indice];
    explicar(paso.rtl, paso.texto, Boolean(paso.error));
    pintarFases(paso.fase);
    pintarLista();
    marcarActivos(paso.activos);
    pintarEsquema();

    for (const movimiento of paso.movimientos) {
      if (!await animar(movimiento, miTurno)) return false;
    }
    if (!paso.movimientos.length && conPausa && !await pausa(miTurno)) return false;

    aplicarPaso(paso);
    indice += 1;
    pintarEsquema();
    pintarLista();

    if (indice === ciclo.pasos.length) {
      confirmarInstruccion();
      elemento("cpu-lista").querySelectorAll("li").forEach((item) => { item.className = "hecho"; });
    }
    return true;
  }

  async function ejecutar(alcance) {
    if (ocupado) return;
    ocupado = true;
    reproduciendo = alcance === "programa";
    actualizarBotones();
    turno += 1;
    const miTurno = turno;
    let sigue = true;
    do {
      sigue = await avanzar(miTurno, alcance !== "micro");
      if (sigue && alcance === "programa" && !ciclo && maquina.terminado) sigue = false;
      if (sigue && alcance === "instruccion" && !ciclo) sigue = false;
    } while (sigue && alcance !== "micro");
    if (miTurno === turno) {
      ocupado = false;
      reproduciendo = false;
      actualizarBotones();
    }
  }

  function reiniciar() {
    detener();
    ciclo = null;
    maquina.reiniciar();
    anterior = null;
    pintarLista();
    pintar();
  }

  construir();
  elemento("cpu-micro").addEventListener("click", () => ejecutar("micro"));
  elemento("cpu-instruccion").addEventListener("click", () => ejecutar("instruccion"));
  elemento("cpu-reproducir").addEventListener("click", () => {
    if (reproduciendo) detener();
    else ejecutar("programa");
  });
  elemento("cpu-reiniciar").addEventListener("click", reiniciar);

  return {
    sincronizar,
    enCurso: () => ciclo !== null,
    alCambiarVista(nombre) {
      if (nombre !== "cpu" && ocupado) detener();
    },
    velocidad: () => Number(elemento("cpu-velocidad").value),
    ponerVelocidad(valor) {
      if (valor >= 1 && valor <= DURACIONES_MS.length) elemento("cpu-velocidad").value = valor;
    },
  };
})();
