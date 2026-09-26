import { type Request } from '../contracts';
import { enqueue } from '../services/outbox';
export async function retention(req: Request) {
  await enqueue({ kind: 'retention.requested', id: req.id });
  return { status: 202, body: 'queued' };
}
