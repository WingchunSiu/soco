import { charge, type Request } from '../contracts';
import { submit } from '../services/recovery';
export async function refunds(req: Request) {
  await charge(req.id);
  await submit({ kind: 'refund.requested', id: req.id });
  return { status: 202, body: { refund: req.id } };
}
