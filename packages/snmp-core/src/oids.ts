/**
 * Catálogo central de OIDs.
 *
 * Regla de arquitectura (sección 11): los OIDs NO viven dentro del servicio
 * principal ni dispersos en los adaptadores. Se declaran aquí, agrupados por
 * MIB, y los adaptadores los referencian.
 */

// --- MIB-II / System (RFC 1213) ---
export const SYSTEM = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectID: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysContact: "1.3.6.1.2.1.1.4.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0",
} as const;

// --- Printer-MIB (RFC 3805) ---
export const PRINTER = {
  /** prtGeneralPrinterName */
  printerName: "1.3.6.1.2.1.43.5.1.1.16.1",
  /** prtGeneralSerialNumber */
  serialNumber: "1.3.6.1.2.1.43.5.1.1.17.1",

  /** prtMarkerLifeCount — contador total de páginas (columna, se walk-ea). */
  markerLifeCount: "1.3.6.1.2.1.43.10.2.1.4",

  /** Consumibles (columnas a walk-ear; el índice une las filas). */
  suppliesDescription: "1.3.6.1.2.1.43.11.1.1.6",
  suppliesType: "1.3.6.1.2.1.43.11.1.1.5",
  suppliesMaxCapacity: "1.3.6.1.2.1.43.11.1.1.8",
  suppliesLevel: "1.3.6.1.2.1.43.11.1.1.9",
  suppliesUnit: "1.3.6.1.2.1.43.11.1.1.7",

  /**
   * Bandejas de entrada (prtInput, RFC 3805). Columnas verificadas por SNMP
   * walk en RICOH real (192.0.2.31):
   *   .3  DimUnit          (3=diezmilésimas de pulgada, 4=micrómetros)
   *   .4  MediaDimFeedDir  (dimensión en la dirección de avance)
   *   .5  MediaDimXFeedDir (dimensión perpendicular)
   *   .8  CapacityUnit     (8=hojas, 7=impresiones, 19=%, …)
   *   .9  MaxCapacity      (−1/−2 = desconocido)
   *   .10 CurrentLevel     (−1/−2/−3 = desconocido/ilimitado)
   *   .12 MediaName        (tipo de papel: "Normal 2", "A4", …)
   *   .13 Name             (nombre de la bandeja: "Tray 1", "Bypass Tray")
   */
  inputDescription: "1.3.6.1.2.1.43.8.2.1.13",
  inputDimUnit: "1.3.6.1.2.1.43.8.2.1.3",
  inputMediaDimFeedDir: "1.3.6.1.2.1.43.8.2.1.4",
  inputMediaDimXFeedDir: "1.3.6.1.2.1.43.8.2.1.5",
  inputCapacityUnit: "1.3.6.1.2.1.43.8.2.1.8",
  inputMaxCapacity: "1.3.6.1.2.1.43.8.2.1.9",
  inputCurrentLevel: "1.3.6.1.2.1.43.8.2.1.10",
  inputMediaName: "1.3.6.1.2.1.43.8.2.1.12",
} as const;

// --- HOST-RESOURCES-MIB (RFC 2790) ---
export const HOST_RESOURCES = {
  /** hrPrinterStatus: 1=other 2=unknown 3=idle 4=printing 5=warmup */
  printerStatus: "1.3.6.1.2.1.25.3.5.1.1",
  /** hrPrinterDetectedErrorState (bit field). */
  detectedErrorState: "1.3.6.1.2.1.25.3.5.1.2",
} as const;

// --- Interfaces (para MAC) ---
export const INTERFACES = {
  /** ifPhysAddress (columna). */
  physAddress: "1.3.6.1.2.1.2.2.1.6",
} as const;

/**
 * OIDs privados por fabricante. Solo se consultan tras detectar el fabricante
 * y siempre de forma tolerante a fallos (secciones 12 y 34).
 *
 * RICOH — rama enterprise 1.3.6.1.4.1.367 (Fase 7: soporte avanzado).
 *
 * IMPORTANTE (regla de oro, secciones 12/33/34):
 *   - Primero SIEMPRE los OIDs estándar (Printer-MIB/HOST-RESOURCES/MIB-II).
 *     Estos OIDs privados son ADITIVOS y OPCIONALES: enriquecen el resultado
 *     estándar cuando el modelo los expone y se ignoran si no existen.
 *   - Nunca se asume que un OID legible puede escribirse (sección 33).
 *
 * ⚠️  ESTADO DE VERIFICACIÓN: los sufijos privados exactos de RICOH varían por
 *     modelo/generación (familia MP vs IM, controladores GW/GWNX) y NO todos
 *     están documentados públicamente. Los valores de abajo marcados como
 *     "ASUMIDO" son PLACEHOLDERS PLAUSIBLES bajo la rama 367 y deben validarse
 *     contra hardware real antes de confiar en ellos (ver docs/ricoh-oids.md).
 *     Lo único VERIFICADO es el prefijo enterprise 367 (IANA / sysObjectID).
 */
export const RICOH = {
  /** VERIFICADO: número de empresa IANA de RICOH (sysObjectID). */
  enterprise: "1.3.6.1.4.1.367",

  /**
   * ASUMIDO: rama base observada en muchos MFP RICOH para info de producto /
   * motor. Sirve de raíz común de los OIDs privados de abajo.
   */
  base: "1.3.6.1.4.1.367.3.2.1",

  /**
   * Firmware del sistema/controlador.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real.
   */
  firmwareVersion: "1.3.6.1.4.1.367.3.2.1.1.1.6.0",

  /**
   * Tabla de contadores RICOH (VERIFICADA contra hardware real, familias IM/MP).
   * Es una tabla donde cada fila es un contador con nombre y valor:
   *   - columna .5 = NOMBRE del contador en inglés (clave estable), p.ej.
   *     "Counter: Machine Total", "Counter:Copy:Total", "Counter:Print:Total",
   *     "Counter:FAX:Total", "Counter:Transmission:Total",
   *     "Counter:Copy:Full Color", "Counter:Print:Full Color", etc.
   *   - columna .9 = VALOR (páginas acumuladas).
   * Se unen por índice de fila y se mapean por nombre a nuestros CounterType.
   */
  counterTable: {
    nameColumn: "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5", // VERIFICADO (nombre EN)
    valueColumn: "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9", // VERIFICADO (valor)
  },
  /** Respaldo del TOTAL si el estándar no lo entregó. */
  counterTotalBackup: "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.1", // "Counter: Machine Total"

  /**
   * Consumibles avanzados que el estándar Printer-MIB no siempre expone en
   * modelos RICOH. Cada OID es el NIVEL actual normalizado a 0-100 (escalar).
   * ASUMIDOS / PLACEHOLDER — validar contra hardware real.
   */
  supplies: {
    wasteTonerLevel: "1.3.6.1.4.1.367.3.2.1.2.24.1.1.5.1", // ASUMIDO
    drumLevel: "1.3.6.1.4.1.367.3.2.1.2.24.1.1.5.2", // ASUMIDO
    fuserLevel: "1.3.6.1.4.1.367.3.2.1.2.24.1.1.5.3", // ASUMIDO
    maintenanceKitLevel: "1.3.6.1.4.1.367.3.2.1.2.24.1.1.5.4", // ASUMIDO
  },
} as const;

// ===========================================================================
// Fase 8 — OIDs privados de OTROS fabricantes (secciones 11 y 32).
//
// AÑADIDOS de forma ADITIVA: no se toca ninguna sección anterior. Mismo
// contrato que RICOH (arriba):
//   - El camino estándar (Printer-MIB / HOST-RESOURCES / MIB-II) es SIEMPRE la
//     fuente primaria. Estos OIDs privados son ADITIVOS, OPCIONALES y se leen
//     de forma TOLERANTE: si el modelo no los expone, se ignoran sin romper.
//   - Nunca se asume que un OID legible pueda escribirse.
//
// ⚠️  ESTADO DE VERIFICACIÓN: lo único VERIFICADO por fabricante es el número
//     de empresa IANA (`enterprise`, usado para detección por sysObjectID). Los
//     sufijos privados concretos (firmware, etc.) NO están documentados de forma
//     uniforme entre modelos/generaciones y aquí son PLACEHOLDERS PLAUSIBLES
//     marcados "ASUMIDO". DEBEN validarse contra hardware real antes de confiar
//     en ellos. Por eso los adaptadores de estos fabricantes se apoyan
//     esencialmente en la herencia estándar y solo enriquecen lo mínimo tolerable.
// ===========================================================================

/** HP — rama enterprise 1.3.6.1.4.1.11. */
export const HP = {
  /** VERIFICADO: número de empresa IANA de HP (sysObjectID). */
  enterprise: "1.3.6.1.4.1.11",
  /**
   * Firmware/datestamp del dispositivo.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real (rama hpicf/npCard).
   */
  firmwareVersion: "1.3.6.1.4.1.11.2.3.9.1.1.3.0", // ASUMIDO
} as const;

/** Canon — rama enterprise 1.3.6.1.4.1.1602. */
export const CANON = {
  /** VERIFICADO: número de empresa IANA de Canon (sysObjectID). */
  enterprise: "1.3.6.1.4.1.1602",
  /**
   * Versión de firmware del controlador.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real.
   */
  firmwareVersion: "1.3.6.1.4.1.1602.1.1.1.1.4.0", // ASUMIDO
} as const;

/** Brother — rama enterprise 1.3.6.1.4.1.2435. */
export const BROTHER = {
  /** VERIFICADO: número de empresa IANA de Brother (sysObjectID). */
  enterprise: "1.3.6.1.4.1.2435",
  /**
   * Versión de firmware.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real.
   */
  firmwareVersion: "1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.1.0", // ASUMIDO
} as const;

/** Kyocera — rama enterprise 1.3.6.1.4.1.1347. */
export const KYOCERA = {
  /** VERIFICADO: número de empresa IANA de Kyocera (sysObjectID). */
  enterprise: "1.3.6.1.4.1.1347",
  /**
   * Versión de firmware del sistema.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real.
   */
  firmwareVersion: "1.3.6.1.4.1.1347.43.5.1.1.28.1", // ASUMIDO
} as const;

/** Xerox — rama enterprise 1.3.6.1.4.1.253. */
export const XEROX = {
  /** VERIFICADO: número de empresa IANA de Xerox (sysObjectID). */
  enterprise: "1.3.6.1.4.1.253",
  /**
   * Versión de firmware / software del sistema.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real.
   */
  firmwareVersion: "1.3.6.1.4.1.253.8.53.3.2.1.3.1", // ASUMIDO
} as const;

/** Lexmark — rama enterprise 1.3.6.1.4.1.641. */
export const LEXMARK = {
  /** VERIFICADO: número de empresa IANA de Lexmark (sysObjectID). */
  enterprise: "1.3.6.1.4.1.641",
  /**
   * Versión de código base / firmware.
   * ASUMIDO / PLACEHOLDER — validar contra hardware real.
   */
  firmwareVersion: "1.3.6.1.4.1.641.2.1.2.1.2.1", // ASUMIDO
} as const;

/** Semántica de valores especiales de Printer-MIB para niveles. */
export const SUPPLY_LEVEL = {
  UNKNOWN: -1,
  SOME_REMAINING: -2,
  UNRESTRICTED_REMAINING: -3, // (prtInput) capacidad no reportada
} as const;
