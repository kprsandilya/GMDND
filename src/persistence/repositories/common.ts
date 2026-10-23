import type { Row } from "../driver";

export const newId = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const bool = (value: unknown): boolean => value === 1 || value === true || value === "1";
export const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
export const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
export const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export function requireRow<T extends Row>(rows: T[], what: string, id: string): T {
  const row = rows[0];
  if (!row) throw new NotFoundError(what, id);
  return row;
}

/** Builds `SET a = ?, b = ?` from a patch, ignoring undefined values. */
export function buildSet(patch: Record<string, unknown>, serialize: Record<string, (v: unknown) => unknown> = {}) {
  const columns: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    columns.push(`${key} = ?`);
    const serialized = serialize[key] ? serialize[key]!(value) : value;
    params.push(toParam(serialized));
  }
  return { set: columns.join(", "), params, empty: columns.length === 0 };
}

export function toParam(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

export const json = (v: unknown) => JSON.stringify(v ?? null);
export const int = (v: unknown) => (v ? 1 : 0);
