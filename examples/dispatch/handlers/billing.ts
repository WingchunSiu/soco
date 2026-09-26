import { charge, type Request } from '../contracts';
import { record } from '../services/journal';
export async function billing(req: Request) {
  await Promise.all([charge(req.id), record({ kind: 'invoice.charged', id: req.id })]);
  return { status: 201, body: { invoice: req.id } };
}
