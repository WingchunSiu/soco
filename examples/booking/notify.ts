const outbox: string[] = [];

export function sendCancelMail(ownerId: string, seatId: string): void {
  outbox.push(`cancelled ${seatId} for ${ownerId}`);
}

export function sendBookMail(ownerId: string, seatId: string): void {
  outbox.push(`booked ${seatId} for ${ownerId}`);
}

export function pendingMail(): number {
  return outbox.length;
}
