import { updateEntity, type Request } from '../contracts';
import { publish } from '../services/bus';
export async function orders(req: Request) {
  await updateEntity(req.id, req.body);
  await publish({ kind: 'order.updated', id: req.id });
  return { status: 202, body: { accepted: req.id } };
}
