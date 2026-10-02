/**
 * Roles y jerarquía (sección 24). Administrator ⊃ Technician ⊃ Viewer.
 *
 * Un rol superior hereda las capacidades de los inferiores, por lo que
 * `hasRoleAtLeast(user, "Viewer")` es cierto para cualquier rol conocido.
 */
export const ROLES = ["Viewer", "Technician", "Administrator"] as const;
export type Role = (typeof ROLES)[number];

/** Nivel numérico por rol (mayor = más privilegios). */
const LEVEL: Record<Role, number> = {
  Viewer: 1,
  Technician: 2,
  Administrator: 3,
};

/** true si `value` es un rol conocido. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * true si `role` cumple al menos el nivel de `required` según la jerarquía.
 * Un rol desconocido no cumple ningún requisito.
 */
export function hasRoleAtLeast(role: string, required: Role): boolean {
  if (!isRole(role)) return false;
  return LEVEL[role] >= LEVEL[required];
}

/**
 * true si `role` está permitido cuando se exige pertenecer a `allowed`.
 * Se respeta la jerarquía: basta cumplir el MENOR de los roles listados.
 * Ej.: requireRole("Technician") también deja pasar a Administrator.
 */
export function roleSatisfies(role: string, allowed: readonly Role[]): boolean {
  if (allowed.length === 0) return isRole(role);
  const minRequired = allowed.reduce<Role>(
    (min, r) => (LEVEL[r] < LEVEL[min] ? r : min),
    allowed[0],
  );
  return hasRoleAtLeast(role, minRequired);
}
