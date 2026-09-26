import { type Request } from '../contracts';
import { record } from '../services/journal';
export async function webhook(req: Request) {
  void record({ kind: 'webhook.received', id: req.id });
  return { status: 202, body: 'received' };
}
