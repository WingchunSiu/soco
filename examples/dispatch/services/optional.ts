import { type Event } from '../contracts';
import { record } from './journal';
export async function attempt(event: Event): Promise<void> {
  try {
    await record(event);
  } catch {
    return;
  }
}
