import { render, type Request } from '../contracts';
export async function preview(req: Request) {
  const html = await render(req.id);
  return { status: 200, body: html };
}
