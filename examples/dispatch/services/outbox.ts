import { commitOutbox, type Event } from '../contracts';
export async function enqueue(event: Event): Promise<void> {
  await commitOutbox([event]);
}
