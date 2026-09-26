import { updateEntity, type Request } from '../contracts';
import { attempt } from '../services/optional';
export async function preferences(req: Request) {
  await updateEntity(req.user, req.body);
  await attempt({ kind: 'preferences.changed', id: req.id });
  return { status: 200, body: 'saved' };
}
