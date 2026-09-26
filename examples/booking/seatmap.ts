export function seatLabel(seatId: string): string {
  const row = seatId.slice(0, 1);
  const number = seatId.slice(1);
  return `Row ${row}, seat ${number}`;
}

export function sectionFor(seatId: string): string {
  return seatId < "M" ? "orchestra" : "balcony";
}
