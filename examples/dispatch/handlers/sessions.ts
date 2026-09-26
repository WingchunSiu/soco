import { type Request } from '../contracts';
import { recordSync } from '../services/journal';
export function sessions(req: Request) {
  recordSync({ kind: 'session.created', id: req.id });
  return { status: 201, body: { session: req.id } };
}
