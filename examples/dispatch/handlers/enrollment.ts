import { type Request } from '../contracts';
import { withRetry } from '../services/retry';
export async function enrollment(req: Request) {
  await withRetry({ kind: 'member.enrolled', id: req.id });
  return { status: 201, body: req.user };
}
