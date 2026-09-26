import { type Event } from '../contracts';
import { record } from './journal';
const pending: Event[] = [];
export async function publish(event: Event): Promise<void> {
  pending.push(event);
}
export async function drain(): Promise<void> {
  while (pending.length) {
    const event = pending[0];
    await record(event);
    pending.shift();
  }
}
