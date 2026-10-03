/**
 * Community SNMP por impresora (sección 23).
 *
 * Se guarda CIFRADA en `Printer.snmpCommunityEncrypted` (AES-256-GCM, ver
 * secrets.ts) y nunca sale al navegador: las consultas que devuelven filas de
 * impresora la omiten con `OMIT_COMMUNITY`. Al sondear se descifra.
 *
 * Si la impresora no tiene community guardada, o tiene el marcador "***" que
 * guardaban las versiones anteriores (no conservaban la real), se usa la
 * community por defecto del entorno: así siguen funcionando como antes.
 */
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

/** Lo que guardaban las versiones anteriores en lugar de la community real. */
const LEGACY_PLACEHOLDER = "***";

/** Para el `omit` de Prisma: la community no se devuelve nunca, ni cifrada. */
export const OMIT_COMMUNITY = { snmpCommunityEncrypted: true } as const;

/** Valor a guardar en la BD (null si no hay community explícita). */
export function encryptCommunity(community: string | null | undefined): string | null {
  return community ? encryptSecret(community) : null;
}

/** Community con la que se sondea una impresora a partir de lo guardado. */
export function communityFor(stored: string | null | undefined): string {
  if (!stored || stored === LEGACY_PLACEHOLDER) return config.snmp.defaultCommunity;
  // decryptSecret devuelve "" si la llave cambió o el dato está corrupto.
  return decryptSecret(stored) || config.snmp.defaultCommunity;
}
