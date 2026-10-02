/**
 * Fixture de una RICOH IM C4500 (respuestas SNMP simuladas).
 *
 * Permite ejecutar el slice vertical completo sin una impresora real
 * (SNMP_MOCK=true). Los valores imitan el formato real de Printer-MIB.
 */
export const ricohImC4500Fixture: Record<string, unknown> = {
  // MIB-II / System
  "1.3.6.1.2.1.1.1.0": "RICOH IM C4500 1.15 / RICOH Network Printer C model",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.367.1.1",
  "1.3.6.1.2.1.1.3.0": 1_234_567_800, // timeticks (~142 días)
  "1.3.6.1.2.1.1.4.0": "IT Department",
  "1.3.6.1.2.1.1.5.0": "Finance-01",
  "1.3.6.1.2.1.1.6.0": "Finance",

  // Printer-MIB: identidad
  "1.3.6.1.2.1.43.5.1.1.16.1": "RICOH IM C4500",
  "1.3.6.1.2.1.43.5.1.1.17.1": "3120R840012",

  // Printer-MIB: contador total (prtMarkerLifeCount)
  "1.3.6.1.2.1.43.10.2.1.4.1.1": 154332,

  // hrPrinterStatus (3 = idle/ready)
  "1.3.6.1.2.1.25.3.5.1.1.1": 3,
  "1.3.6.1.2.1.25.3.5.1.2.1": Buffer.from([0x00, 0x00]), // sin errores

  // ifPhysAddress (MAC)
  "1.3.6.1.2.1.2.2.1.6.1": Buffer.from([0x00, 0x26, 0x73, 0x1a, 0x2b, 0x3c]),

  // --- Consumibles (prtMarkerSupplies), 4 filas ---
  // Descripción (col .6)
  "1.3.6.1.2.1.43.11.1.1.6.1.1": "Black Toner",
  "1.3.6.1.2.1.43.11.1.1.6.1.2": "Cyan Toner",
  "1.3.6.1.2.1.43.11.1.1.6.1.3": "Magenta Toner",
  "1.3.6.1.2.1.43.11.1.1.6.1.4": "Yellow Toner",
  // Tipo (col .5) — 3 = toner
  "1.3.6.1.2.1.43.11.1.1.5.1.1": 3,
  "1.3.6.1.2.1.43.11.1.1.5.1.2": 3,
  "1.3.6.1.2.1.43.11.1.1.5.1.3": 3,
  "1.3.6.1.2.1.43.11.1.1.5.1.4": 3,
  // Capacidad máxima (col .8)
  "1.3.6.1.2.1.43.11.1.1.8.1.1": 100,
  "1.3.6.1.2.1.43.11.1.1.8.1.2": 100,
  "1.3.6.1.2.1.43.11.1.1.8.1.3": 100,
  "1.3.6.1.2.1.43.11.1.1.8.1.4": 100,
  // Nivel actual (col .9)
  "1.3.6.1.2.1.43.11.1.1.9.1.1": 82,
  "1.3.6.1.2.1.43.11.1.1.9.1.2": 63,
  "1.3.6.1.2.1.43.11.1.1.9.1.3": 71,
  "1.3.6.1.2.1.43.11.1.1.9.1.4": 54,

  // --- Bandeja de entrada (prtInput), 1 fila ---
  "1.3.6.1.2.1.43.8.2.1.13.1.1": "Tray 1",
  "1.3.6.1.2.1.43.8.2.1.9.1.1": 500, // capacidad
  "1.3.6.1.2.1.43.8.2.1.10.1.1": 320, // nivel actual
  "1.3.6.1.2.1.43.8.2.1.12.1.1": "A4",

  // ===================================================================
  // Fase 7 — OIDs privados RICOH (rama 1.3.6.1.4.1.367). AÑADIDOS de forma
  // ADITIVA: no se toca ninguno de los OIDs estándar de arriba. Los sufijos
  // son ASUMIDOS/PLACEHOLDER (ver oids.ts y docs/ricoh-oids.md); aquí solo
  // sirven para ejercitar el RicohPrinterAdapter en modo mock.
  //
  // Nota: los CONSUMIBLES avanzados RICOH NO se declaran en este fixture
  // compartido (otro agente escanea con él y espera 4 consumibles estándar);
  // se ejercitan con `ricoh-im-c4500-advanced.ts`.
  // ===================================================================

  // Firmware (RICOH.firmwareVersion) — ASUMIDO
  "1.3.6.1.4.1.367.3.2.1.1.1.6.0": "System 1.15 / Engine 2.03",

  // Tabla de contadores RICOH — columna .5 = NOMBRE, columna .9 = VALOR.
  // (Estructura VERIFICADA contra hardware real; aquí valores de ejemplo.)
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.1": "Counter: Machine Total",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.1": 154332,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.2": "Counter:Copy:Total",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.2": 40000,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.3": "Counter:Copy:Black & White",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.3": 15000,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.4": "Counter:Copy:Full Color",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.4": 25000,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.5": "Counter:Print:Total",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.5": 100000,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.6": "Counter:Print:Black & White",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.6": 35000,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.7": "Counter:Print:Full Color",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.7": 65000,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.8": "Counter:FAX:Total",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.8": 1290,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.9": "Counter:FAX:Black & White",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.9": 1290,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.10": "Counter:Transmission:Total",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.10": 33456,
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.5.11": "No. of Printed Sides in Duplex",
  "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.11": 5000,
};
