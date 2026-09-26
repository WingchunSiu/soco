let skewMs = 0;

export function setSkew(ms: number): void {
  skewMs = ms;
}

export function nowMs(): number {
  return Date.now() + skewMs;
}

export function formatLocal(ms: number): string {
  return new Date(ms).toISOString();
}
