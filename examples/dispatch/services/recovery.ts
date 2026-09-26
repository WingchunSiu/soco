import { type Event } from '../contracts';
import { record } from './journal';
const retryBuffer = new Map<string, Event>();
export async function submit(event: Event): Promise<void> {
  retryBuffer.set(event.id, event);
  queueMicrotask(() => { void flush().catch(() => {}); });
}
export async function flush(): Promise<void> {
  for (const [id, event] of retryBuffer) {
    await record(event);
    retryBuffer.delete(id);
  }
}
