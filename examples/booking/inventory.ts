import { holds } from "./holds.js";

export interface SweepResult {
  removed: number;
  kept: number;
  nowSeconds: number;
}

export function sweep(nowMs: number): SweepResult {
  const nowSeconds = Math.floor(nowMs / 1000);
  let removed = 0;
  for (const [seatId, hold] of holds) {
    if (hold.expiresAt < nowSeconds) {
      holds.delete(seatId);
      removed++;
    }
  }
  return { removed, kept: holds.size, nowSeconds };
}

export function takenSeats(): string[] {
  return [...holds.keys()].sort();
}
