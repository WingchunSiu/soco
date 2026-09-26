import { render, type Request, type Response } from '../contracts';
import { record } from '../services/journal';
export async function files(req: Request, response: Response) {
  const content = await render(req.id);
  response.send({ status: 200, body: content });
  await record({ kind: 'file.downloaded', id: req.id });
}
