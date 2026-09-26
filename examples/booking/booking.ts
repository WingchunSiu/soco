import { createHold, holds } from "./holds.js";
import { quote } from "./pricing.js";
import { seatLabel } from "./seatmap.js";

export interface BookResult {
  seatId: string;
  label: string;
  accepted: boolean;
  priceCents: number;
  reason: "taken" | "booked";
}

export function book(seatId: string, ownerId: string, eventId: string): BookResult {
  const priceCents = quote(eventId, seatId);
  const label = seatLabel(seatId);
  if (holds.has(seatId)) return { seatId, label, accepted: false, priceCents, reason: "taken" };
  createHold(seatId, ownerId);
  return { seatId, label, accepted: true, priceCents, reason: "booked" };
}

export function bookRow(seatIds: string[], ownerId: string, eventId: string): BookResult[] {
  return seatIds.map(seatId => book(seatId, ownerId, eventId));
}
