// src/utils/parsers.ts
export const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return 0;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true") return true;
    if (normalised === "false") return false;
  }

  return Boolean(value);
};

