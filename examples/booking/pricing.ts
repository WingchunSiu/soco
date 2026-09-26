const base = new Map<string, number>([["concert", 4800], ["play", 3200]]);
const quoted = new Map<string, number>();

export function quote(eventId: string, seatId: string): number {
  const key = `${eventId}:${seatId}`;
  const cached = quoted.get(key);
  if (cached !== undefined) return cached;
  const price = (base.get(eventId) ?? 2500) + (seatId.charCodeAt(0) % 7) * 100;
  quoted.set(key, price);
  return price;
}

export function clearQuote(eventId: string, seatId: string): void {
  quoted.delete(`${eventId}:${seatId}`);
}
