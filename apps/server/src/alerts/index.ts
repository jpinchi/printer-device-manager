/**
 * Punto de entrada del módulo de Alertas (Fase 5).
 *
 * Reexporta la lógica pura, la persistencia y el router de Express para que el
 * orquestador y otros módulos (p.ej. el polling) los consuman.
 */
export * from "./types.js";
export * from "./engine.js";
export * from "./persistence.js";
export { alertsRouter } from "./alerts-routes.js";
