import { type Request } from '../contracts';
export function locale(req: Request) {
  const locale = req.body === 'fr' ? 'fr-FR' : 'en-US';
  return { status: 200, body: { locale } };
}
