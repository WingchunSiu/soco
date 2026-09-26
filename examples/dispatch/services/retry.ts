import { type Event } from '../contracts';
import { record } from './journal';
export async function withRetry(event: Event): Promise<void> {
  try {
    await record(event);
  } catch {
    await record(event);
  }
}
