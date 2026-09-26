export const HOLD_MS = 15 * 60 * 1000;

export interface Hold {
  seatId: string;
  ownerId: string;
  expiresAt: number;
  status: "active" | "cancelled";
  createdAt: number;
}

export const holds = new Map<string, Hold>();

export function createHold(seatId: string, ownerId: string): Hold {
  const now = Date.now();
  const hold: Hold = { seatId, ownerId, expiresAt: now + HOLD_MS, status: "active", createdAt: now };
  holds.set(seatId, hold);
  return hold;
}

export function getHold(seatId: string): Hold | undefined {
  return holds.get(seatId);
}

export function holdCount(): number {
  return holds.size;
}
