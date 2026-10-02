/**
 * Tests del cifrado de secretos en reposo (secrets.ts).
 *
 * Se fija PDM_SECRET_KEY ANTES de importar el módulo para que la llave sea
 * determinista y no se cree ningún archivo `.pdm-secret.key` en el repo.
 */
import { describe, it, expect, beforeAll } from "vitest";

let encryptSecret: typeof import("./secrets.js").encryptSecret;
let decryptSecret: typeof import("./secrets.js").decryptSecret;
let isEncrypted: typeof import("./secrets.js").isEncrypted;

beforeAll(async () => {
  process.env.PDM_SECRET_KEY = "clave-de-prueba-para-tests-1234567890";
  const mod = await import("./secrets.js");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  isEncrypted = mod.isEncrypted;
});

describe("secrets — cifrado en reposo", () => {
  it("round-trip: descifrar(cifrar(x)) === x", () => {
    const secret = "Sup3r-Secreta!ñÁ@";
    const enc = encryptSecret(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(secret); // el texto plano NO aparece en el cifrado
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("el prefijo identifica el formato cifrado", () => {
    expect(encryptSecret("algo").startsWith("enc.v1.")).toBe(true);
  });

  it("dos cifrados del mismo valor difieren (IV aleatorio)", () => {
    expect(encryptSecret("igual")).not.toBe(encryptSecret("igual"));
  });

  it("es idempotente: no re-cifra un valor ya cifrado", () => {
    const once = encryptSecret("hola");
    expect(encryptSecret(once)).toBe(once);
  });

  it("migración transparente: el texto plano heredado se devuelve tal cual", () => {
    expect(decryptSecret("contraseña-vieja-en-claro")).toBe("contraseña-vieja-en-claro");
  });

  it("vacío/null/undefined no se cifran", () => {
    expect(encryptSecret("")).toBe("");
    expect(encryptSecret(null)).toBe("");
    expect(encryptSecret(undefined)).toBe("");
    expect(decryptSecret("")).toBe("");
    expect(decryptSecret(null)).toBe("");
  });

  it("detección de manipulación: un cifrado alterado no descifra (devuelve '')", () => {
    const enc = encryptSecret("intacto");
    // Corrompe el TAG de autenticación (2º segmento tras el prefijo 'enc.v1.').
    const parts = enc.slice("enc.v1.".length).split(".");
    const flip = (c: string) => (c === "A" ? "B" : "A");
    parts[1] = flip(parts[1][0]) + parts[1].slice(1);
    const tampered = "enc.v1." + parts.join(".");
    expect(decryptSecret(tampered)).toBe("");
  });
});
