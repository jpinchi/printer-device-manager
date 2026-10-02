/**
 * Punto de entrada del módulo de Historial y reportes (Fase 6).
 *
 * Reexporta las piezas públicas para que el orquestador y otros módulos las
 * consuman: consultas, agregación pura, CSV, retención y el router de Express.
 */

export * from "./aggregation.js";
export * from "./csv.js";
export * from "./queries.js";
export * from "./retention.js";
export { historyRouter } from "./history-routes.js";
