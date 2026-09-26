import { query, type Request } from '../contracts';
export async function catalog(req: Request) {
  return { status: 200, body: await query(req.body) };
}
