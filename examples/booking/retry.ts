import { book } from "./booking.js";

// Customer cancel deletes the hold immediately. This path only retries a payment timeout.
export function retryPayment(seatId: string, ownerId: string, eventId: string): boolean {
  return book(seatId, ownerId, eventId).accepted;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt);
}
