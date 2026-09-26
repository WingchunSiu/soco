import { updateEntity, type Request } from '../contracts';
import { record } from '../services/journal';
export async function profile(req: Request) {
  await updateEntity(req.user, req.body);
  await record({ kind: 'profile.changed', id: req.id });
  return { status: 200, body: 'updated' };
}
