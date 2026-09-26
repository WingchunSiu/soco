const counters = new Map<string, number>();
export function metrics() {
  return { status: 200, body: Object.fromEntries(counters) };
}
