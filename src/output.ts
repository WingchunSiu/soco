/** Atomic emissions: an oversized print is rejected, never silently cut mid-evidence. */
export class OutputBudget {
  used = 0;
  output = "";
  rejectedChars = 0;
  private cellUsed = 0;
  constructor(readonly total = 16000, readonly perCell = 6000) {}
  resetCell() { this.output = ""; this.rejectedChars = 0; this.cellUsed = 0; }
  emit(value: string): void {
    if (value.length > this.remaining) { this.rejectedChars += value.length; return; }
    this.output += value;
    this.used += value.length;
    this.cellUsed += value.length;
  }
  diagnostic(value: string): string {
    if (value.length > this.remaining) { this.rejectedChars += value.length; return "Cell failed; error details exceed the remaining output budget"; }
    this.used += value.length;
    this.cellUsed += value.length;
    return value;
  }
  get remaining() { return Math.max(0, Math.min(this.total - this.used, this.perCell - this.cellUsed)); }
  status() { return { total: this.total, used: this.used, remaining: Math.max(0, this.total - this.used), cellRemaining: this.remaining, rejectedChars: this.rejectedChars }; }
}

/** Source presentation is compact; the actual objects remain unchanged in state. */
function renderSources(spans: Array<{ path: string; start: number; text: string }>): string {
  let path: string | undefined;
  const output: string[] = [];
  for (const span of spans) {
    if (span.path !== path) { output.push(`FILE ${span.path}`); path = span.path; }
    const lines = span.text.replace(/\r?\n$/, "").split(/\r?\n/);
    output.push(...lines.map((line, i) => `${span.start + i}|${line}`));
  }
  return output.join("\n");
}
export function render(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.path === "string" && Array.isArray(v.lines)) return renderSources(v.lines);
    if (typeof v.path === "string" && typeof v.start === "number" && typeof v.text === "string")
      return renderSources([{ path: v.path, start: v.start, text: v.text }]);
    if (Array.isArray(value) && value.length && value.every(x => x && typeof x === "object" && typeof x.path === "string" && typeof x.text === "string"))
      return renderSources(value);
  }
  return JSON.stringify(value) ?? String(value);
}
