/**
 * Minimal validation helpers for boulder state, keeping the package
 * zero-runtime-dependency. These are intentionally small hand-rolled guards,
 * not a general schema engine.
 * @module dsh-enhance/shared/validate
 */

/** Ensure a value is a finite non-negative integer. */
export function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0
}

/** Ensure a value is a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** Ensure a value is a plain object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Ensure a value is one of the allowed literals. */
export function isOneOf(v: unknown, allowed: readonly string[]): v is string {
  return typeof v === 'string' && allowed.includes(v)
}
