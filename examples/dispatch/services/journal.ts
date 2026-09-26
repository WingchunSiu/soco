import { appendCommitted, appendCommittedSync, type Event } from '../contracts';
export async function record(event: Event): Promise<void> {
  await appendCommitted(event);
}
export function recordSync(event: Event): void {
  appendCommittedSync(event);
}
