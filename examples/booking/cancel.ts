import { getHold } from "./holds.js";
import { sendCancelMail } from "./notify.js";
import { recordCancelMetric } from "./metrics.js";

export interface CancelResult {
  seatId: string;
  accepted: boolean;
  reason: "missing" | "accepted";
}

export function cancel(seatId: string, ownerId: string): CancelResult {
  const hold = getHold(seatId);
  if (!hold || hold.ownerId !== ownerId) return { seatId, accepted: false, reason: "missing" };
  hold.status = "cancelled";
  sendCancelMail(ownerId, seatId);
  recordCancelMetric(seatId);
  return { seatId, accepted: true, reason: "accepted" };
}

export function cancelMany(seatIds: string[], ownerId: string): CancelResult[] {
  return seatIds.map(seatId => cancel(seatId, ownerId));
}
