/**
 * Utilidades de error HTTP: una taxonomía mínima + detección de "BD no
 * disponible", para que el manejador de error CENTRAL distinga 400/404/503/500
 * y nunca filtre stack traces al cliente.
 */
import { Prisma } from "@prisma/client";
import type { RequestHandler } from "express";

/** Error HTTP con status explícito. `message` es seguro para exponer al cliente. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = "No encontrado") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/**
 * ¿El error viene de que la base de datos NO está disponible / no respondió
 * (inicialización, conexión, timeout de socket, pánico del engine)? Sirve para
 * responder 503 en vez de confundirlo con un error de negocio.
 */
export function isDbUnavailable(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P1xxx = errores de conexión/servidor de BD (no de negocio).
    return err.code.startsWith("P1");
  }
  // El "Socket timeout" del engine llega como error genérico con ese texto.
  const msg = err instanceof Error ? err.message : String(err);
  return /socket timeout|timed out|database is locked|unable to open database/i.test(msg);
}

/** Envuelve un handler async para que sus rechazos vayan al manejador central. */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
