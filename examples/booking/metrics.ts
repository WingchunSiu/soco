const cancels = new Map<string, number>();

export function recordCancelMetric(seatId: string): void {
  cancels.set(seatId, (cancels.get(seatId) ?? 0) + 1);
}

export function cancelCount(seatId: string): number {
  return cancels.get(seatId) ?? 0;
}
