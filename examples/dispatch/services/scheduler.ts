import { type Event } from '../contracts';
import { record } from './journal';
export async function schedule(event: Event): Promise<void> {
  setTimeout(() => { void record(event).catch(() => {}); }, 250);
}
