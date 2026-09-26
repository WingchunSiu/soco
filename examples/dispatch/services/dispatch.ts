import { type Event } from '../contracts';
import { record } from './journal';
export async function deliver(event: Event): Promise<{ receipt: string }> {
  await record(event);
  return { receipt: event.id };
}
