export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

export function normalizeName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。、；：:()（）【】[\]"'“”‘’·\-]/g, '');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
