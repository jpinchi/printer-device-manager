"use client";

/**
 * LoginPlexus — fondo animado de "red de partículas" (plexus) para el login.
 *
 * Nodos que flotan y se conectan con líneas según cercanía. Upgrades:
 *  - PROFUNDIDAD + PARALLAX: cada nodo tiene una "profundidad"; los del frente
 *    son mayores, más brillantes y rápidos, y se desplazan más con el cursor
 *    (los del fondo, menos) → sensación 3D.
 *  - PULSOS DE DATOS: destellos que viajan de nodo a nodo por las conexiones,
 *    como tráfico de red.
 *  - HALO DEL CURSOR: un resplandor suave que acompaña al puntero.
 *
 * Cuidados:
 *  - Lienzo <canvas> a resolución del dispositivo (DPR) → líneas nítidas.
 *  - Colores desde los tokens del tema (--color-accent / --color-accent2),
 *    re-leídos al cambiar `data-theme`.
 *  - Respeta `prefers-reduced-motion`: cuadro estático, sin bucle ni pulsos.
 *  - Se PAUSA con la pestaña oculta; densidad de nodos acotada por área.
 *  - Limpieza total al desmontar. El <canvas> es `pointer-events-none`; el
 *    cursor se sigue con `pointermove` en window.
 */
import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  depth: number; // 0.35 (fondo) … 1 (frente)
  px: number; // coordenada de dibujo (con parallax) — se recalcula por cuadro
  py: number;
}

interface Pulse {
  a: number; // índice del nodo origen
  b: number; // índice del nodo destino
  t: number; // progreso 0→1
  speed: number;
}

/** Lee una tripleta "R G B" de una variable CSS; con respaldo. */
function readRGB(varName: string, fallback: [number, number, number]): [number, number, number] {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const m = raw.match(/(\d+)\s+(\d+)\s+(\d+)/);
  if (!m) return fallback;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function LoginPlexus() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx0 = canvasEl.getContext("2d");
    if (!ctx0) return;
    // Copias con TIPO no-nulo explícito (TS conserva el tipo en los closures).
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx0;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let raf = 0;
    let running = true;

    // Colores del tema (se refrescan al cambiar data-theme). Tonos SUAVES: se
    // baja la opacidad de líneas/nodos para que no se vean saturados.
    let accent: [number, number, number] = [56, 189, 248];
    let accent2: [number, number, number] = [129, 140, 248];
    let lineBoost = 0.9; // en claro sube un poco para leer sobre fondo claro
    const refreshColors = () => {
      accent = readRGB("--color-accent", [56, 189, 248]);
      accent2 = readRGB("--color-accent2", [129, 140, 248]);
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      lineBoost = isLight ? 1.05 : 0.9;
    };
    refreshColors();

    const pointer = { x: -1, y: -1, active: false };

    const MAX_DIST = 138; // distancia máxima de línea entre nodos
    const MOUSE_DIST = 190; // radio de influencia del cursor (solo halo/líneas)
    const MAX_PULSES = 18;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      // Nitidez 4K: se usa la densidad real del dispositivo (hasta 3x) para que
      // líneas y nodos se vean crujientes en pantallas de alta resolución.
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Más constelaciones: mayor densidad de nodos (acotada para no recargar).
      const target = Math.round((width * height) / 10000);
      const count = Math.min(Math.max(target, 60), 180);
      nodes = new Array(count).fill(0).map(() => spawn());
      pulses = [];
    }

    function spawn(): Node {
      const depth = 0.35 + Math.random() * 0.65;
      const speed = reduceMotion ? 0 : 0.28 * (0.5 + depth * 0.7);
      const a = Math.random() * Math.PI * 2;
      const x = Math.random() * width;
      const y = Math.random() * height;
      return {
        x,
        y,
        vx: Math.cos(a) * speed * (0.4 + Math.random()),
        vy: Math.sin(a) * speed * (0.4 + Math.random()),
        r: 0.8 + Math.random() * 1.7,
        depth,
        px: x,
        py: y,
      };
    }

    /** Crea un pulso entre un nodo y un vecino conectado (si lo hay). */
    function spawnPulse() {
      if (nodes.length < 2) return;
      const i = (Math.random() * nodes.length) | 0;
      const a = nodes[i];
      const candidates: number[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy < MAX_DIST * MAX_DIST) candidates.push(j);
      }
      if (!candidates.length) return;
      const b = candidates[(Math.random() * candidates.length) | 0];
      pulses.push({ a: i, b, t: 0, speed: 0.009 + Math.random() * 0.008 });
    }

    function step() {
      ctx.clearRect(0, 0, width, height);

      const [ar, ag, ab] = accent;
      const [br, bg, bb] = accent2;

      // Mover nodos (deriva propia). El cursor NO desplaza el campo (sin
      // parallax) ni empuja los nodos: solo resalta con halo/líneas.
      for (const n of nodes) {
        if (!reduceMotion) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
          n.x = Math.max(0, Math.min(width, n.x));
          n.y = Math.max(0, Math.min(height, n.y));
        }
        n.px = n.x;
        n.py = n.y;
      }

      // Halo del cursor (resplandor suave, detrás de líneas y nodos).
      if (pointer.active) {
        const g = ctx.createRadialGradient(
          pointer.x,
          pointer.y,
          0,
          pointer.x,
          pointer.y,
          MOUSE_DIST,
        );
        g.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${0.1 * lineBoost})`);
        g.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, MOUSE_DIST, 0, Math.PI * 2);
        ctx.fill();
      }

      // Líneas entre nodos cercanos (usan las coordenadas con parallax).
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          const d2 = dx * dx + dy * dy;
          if (d2 < MAX_DIST * MAX_DIST) {
            const d = Math.sqrt(d2);
            const depthFactor = 0.5 + ((a.depth + b.depth) / 2) * 0.5;
            const op = (1 - d / MAX_DIST) * 0.38 * lineBoost * depthFactor;
            ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${op})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.stroke();
          }
        }
      }

      // Líneas del cursor a los nodos cercanos (más brillantes, accent2).
      if (pointer.active) {
        for (const n of nodes) {
          const dx = pointer.x - n.px;
          const dy = pointer.y - n.py;
          const d2 = dx * dx + dy * dy;
          if (d2 < MOUSE_DIST * MOUSE_DIST) {
            const d = Math.sqrt(d2);
            const op = (1 - d / MOUSE_DIST) * 0.4 * lineBoost;
            ctx.strokeStyle = `rgba(${br}, ${bg}, ${bb}, ${op})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pointer.x, pointer.y);
            ctx.lineTo(n.px, n.py);
            ctx.stroke();
          }
        }
      }

      // Pulsos de datos que viajan por las conexiones.
      if (!reduceMotion) {
        if (pulses.length < MAX_PULSES && Math.random() < 0.06) spawnPulse();
        for (let k = pulses.length - 1; k >= 0; k--) {
          const p = pulses[k];
          const a = nodes[p.a];
          const b = nodes[p.b];
          p.t += p.speed;
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          // Si los nodos se separaron demasiado, o el pulso terminó, se retira.
          if (p.t >= 1 || dx * dx + dy * dy > MAX_DIST * MAX_DIST * 1.6) {
            pulses.splice(k, 1);
            continue;
          }
          const x = a.px + (b.px - a.px) * p.t;
          const y = a.py + (b.py - a.py) * p.t;
          const fade = Math.sin(p.t * Math.PI); // aparece y desaparece en los extremos
          ctx.beginPath();
          ctx.fillStyle = `rgba(${br}, ${bg}, ${bb}, ${0.7 * fade})`;
          ctx.shadowColor = `rgba(${br}, ${bg}, ${bb}, ${0.7 * fade})`;
          ctx.shadowBlur = 6;
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      // Nodos (radio y brillo según profundidad; halo suave).
      for (const n of nodes) {
        const rr = n.r * (0.55 + n.depth * 0.7);
        const alpha = (0.38 + n.depth * 0.42) * lineBoost;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${alpha})`;
        ctx.shadowColor = `rgba(${ar}, ${ag}, ${ab}, ${alpha})`;
        ctx.shadowBlur = 4 * n.depth;
        ctx.arc(n.px, n.py, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    function loop() {
      if (!running) return;
      step();
      raf = requestAnimationFrame(loop);
    }

    // --- Listeners ---
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active =
        pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };
    const onResize = () => resize();
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduceMotion) {
        running = true;
        loop();
      }
    };
    const themeObserver = new MutationObserver(refreshColors);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    resize();
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduceMotion) {
      step();
    } else {
      loop();
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
