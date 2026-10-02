/**
 * Tests del limitador de intentos (rate-limit.ts): las dos dimensiones de
 * defensa (por IP+usuario y global por IP) y la interacción con clearFails.
 * Todo dentro de la ventana de 15 min, así que no hace falta manipular el reloj.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { blockedSeconds, recordFail, clearFails, __resetRateLimit } from "./rate-limit.js";

beforeEach(() => __resetRateLimit());

describe("rate-limit — por IP+usuario (fuerza bruta a una cuenta)", () => {
  it("no bloquea por debajo del umbral (6 fallos)", () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 5; i++) recordFail(ip, "ana");
    expect(blockedSeconds(ip, "ana")).toBe(0);
  });

  it("bloquea al alcanzar el umbral", () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 6; i++) recordFail(ip, "ana");
    expect(blockedSeconds(ip, "ana")).toBeGreaterThan(0);
  });

  it("otra IP contra el mismo usuario NO queda bloqueada (bloquea al atacante, no a la víctima)", () => {
    const attacker = "10.0.0.3";
    for (let i = 0; i < 6; i++) recordFail(attacker, "ana");
    expect(blockedSeconds(attacker, "ana")).toBeGreaterThan(0);
    expect(blockedSeconds("10.0.0.99", "ana")).toBe(0);
  });

  it("clearFails (login correcto) levanta el bloqueo por IP+usuario", () => {
    const ip = "10.0.0.4";
    for (let i = 0; i < 6; i++) recordFail(ip, "ana");
    expect(blockedSeconds(ip, "ana")).toBeGreaterThan(0);
    clearFails(ip, "ana");
    expect(blockedSeconds(ip, "ana")).toBe(0);
  });
});

describe("rate-limit — global por IP (password spraying / enumeración)", () => {
  it("una IP que rota usernames se bloquea aunque cada usuario tenga pocos fallos", () => {
    const ip = "10.0.1.1";
    // 20 fallos repartidos en 20 usuarios distintos: ninguno llega a 6, pero el
    // contador global de la IP sí llega a IP_MAX_FAILS.
    for (let i = 0; i < 20; i++) recordFail(ip, `user${i}`);
    // Incluso un username nunca visto queda bloqueado por la IP.
    expect(blockedSeconds(ip, "jamas_visto")).toBeGreaterThan(0);
  });

  it("clearFails NO reinicia el freno global (no se puede evadir con un login válido)", () => {
    const ip = "10.0.1.2";
    for (let i = 0; i < 20; i++) recordFail(ip, `user${i}`);
    expect(blockedSeconds(ip, "otro")).toBeGreaterThan(0);
    clearFails(ip, "user0"); // un acierto en una cuenta no debe abrir la puerta
    expect(blockedSeconds(ip, "otro")).toBeGreaterThan(0);
  });

  it("otra IP no se ve afectada por el spraying de la primera", () => {
    const ip = "10.0.1.3";
    for (let i = 0; i < 20; i++) recordFail(ip, `user${i}`);
    expect(blockedSeconds("10.0.1.4", "user0")).toBe(0);
  });
});
