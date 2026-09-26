import { query, type Request } from '../contracts';
export async function search(req: Request) {
  const results = await query(req.body.trim());
  return { status: 200, body: results.slice(0, 10) };
}
