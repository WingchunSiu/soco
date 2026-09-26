import { type Request } from '../contracts';
import { deliver } from '../services/dispatch';
export async function delivery(req: Request) {
  const receipt = await deliver({ kind: 'delivery.booked', id: req.id });
  return { status: 202, body: receipt };
}
