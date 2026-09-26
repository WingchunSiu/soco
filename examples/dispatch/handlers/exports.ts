import { render, type Request } from '../contracts';
import { schedule } from '../services/scheduler';
export async function exports(req: Request) {
  const document = await render(req.id);
  await schedule({ kind: 'export.created', id: req.id });
  return { status: 200, body: document };
}
