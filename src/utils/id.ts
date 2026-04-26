// Deterministic hash-based ID so the same URL always produces the same ID
export function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
