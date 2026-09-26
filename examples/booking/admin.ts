import { holds } from "./holds.js";

export function forceRelease(seatId: string): boolean {
  return holds.delete(seatId);
}

export function listOwners(): string[] {
  return [...new Set([...holds.values()].map(hold => hold.ownerId))].sort();
}
