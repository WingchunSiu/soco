import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Authored development fixture, NOT a production incident or a benchmark.
// The answer key is written outside the corpus before any live run.
const files = {
  'README.md': `# Dispatch service\n\nThis is an authored, read-only investigation fixture. No infrastructure runs here.\nEach exported function under handlers/ is an independent HTTP handler.\nHandlers return response objects, except files.ts, which uses a response sender.\nAudit helper implementations live under services/.\nThe external storage and response primitives are specified in contracts.ts.\nA process may terminate at any instruction; in-memory work and timers are lost.\nA successful HTTP response is observable when a handler returns it or calls response.send().\nOnly a durable audit record (including an audit record in a committed outbox) satisfies the audit requirement.\n`,
  'contracts.ts': `export type Event = { kind: string; id: string };\nexport type Request = { id: string; user: string; body: string };\nexport type Reply = { status: number; body: unknown };\n// Resolves only after the event is on durable storage; rejects on failure.\nexport declare function appendCommitted(event: Event): Promise<void>;\n// Returns only after the event is on durable storage; throws on failure.\nexport declare function appendCommittedSync(event: Event): void;\n// Commits all events atomically to durable storage before resolving.\nexport declare function commitOutbox(events: Event[]): Promise<void>;\nexport declare function updateEntity(id: string, body: string): Promise<void>;\nexport declare function charge(id: string): Promise<void>;\nexport declare function render(id: string): Promise<string>;\nexport declare function query(term: string): Promise<string[]>;\n// send immediately makes the response observable; later awaits cannot retract it.\nexport type Response = { send(reply: Reply): void };\n`,
  'services/journal.ts': `import { appendCommitted, appendCommittedSync, type Event } from '../contracts';\nexport async function record(event: Event): Promise<void> {\n  await appendCommitted(event);\n}\nexport function recordSync(event: Event): void {\n  appendCommittedSync(event);\n}\n`,
  'services/bus.ts': `import { type Event } from '../contracts';\nimport { record } from './journal';\nconst pending: Event[] = [];\nexport async function publish(event: Event): Promise<void> {\n  pending.push(event);\n}\nexport async function drain(): Promise<void> {\n  while (pending.length) {\n    const event = pending[0];\n    await record(event);\n    pending.shift();\n  }\n}\n`,
  'services/recovery.ts': `import { type Event } from '../contracts';\nimport { record } from './journal';\nconst retryBuffer = new Map<string, Event>();\nexport async function submit(event: Event): Promise<void> {\n  retryBuffer.set(event.id, event);\n  queueMicrotask(() => { void flush().catch(() => {}); });\n}\nexport async function flush(): Promise<void> {\n  for (const [id, event] of retryBuffer) {\n    await record(event);\n    retryBuffer.delete(id);\n  }\n}\n`,
  'services/scheduler.ts': `import { type Event } from '../contracts';\nimport { record } from './journal';\nexport async function schedule(event: Event): Promise<void> {\n  setTimeout(() => { void record(event).catch(() => {}); }, 250);\n}\n`,
  'services/dispatch.ts': `import { type Event } from '../contracts';\nimport { record } from './journal';\nexport async function deliver(event: Event): Promise<{ receipt: string }> {\n  await record(event);\n  return { receipt: event.id };\n}\n`,
  'services/optional.ts': `import { type Event } from '../contracts';\nimport { record } from './journal';\nexport async function attempt(event: Event): Promise<void> {\n  try {\n    await record(event);\n  } catch {\n    return;\n  }\n}\n`,
  'services/retry.ts': `import { type Event } from '../contracts';\nimport { record } from './journal';\nexport async function withRetry(event: Event): Promise<void> {\n  try {\n    await record(event);\n  } catch {\n    await record(event);\n  }\n}\n`,
  'services/outbox.ts': `import { commitOutbox, type Event } from '../contracts';\nexport async function enqueue(event: Event): Promise<void> {\n  await commitOutbox([event]);\n}\n`,
  'handlers/orders.ts': `import { updateEntity, type Request } from '../contracts';\nimport { publish } from '../services/bus';\nexport async function orders(req: Request) {\n  await updateEntity(req.id, req.body);\n  await publish({ kind: 'order.updated', id: req.id });\n  return { status: 202, body: { accepted: req.id } };\n}\n`,
  'handlers/refunds.ts': `import { charge, type Request } from '../contracts';\nimport { submit } from '../services/recovery';\nexport async function refunds(req: Request) {\n  await charge(req.id);\n  await submit({ kind: 'refund.requested', id: req.id });\n  return { status: 202, body: { refund: req.id } };\n}\n`,
  'handlers/exports.ts': `import { render, type Request } from '../contracts';\nimport { schedule } from '../services/scheduler';\nexport async function exports(req: Request) {\n  const document = await render(req.id);\n  await schedule({ kind: 'export.created', id: req.id });\n  return { status: 200, body: document };\n}\n`,
  'handlers/webhook.ts': `import { type Request } from '../contracts';\nimport { record } from '../services/journal';\nexport async function webhook(req: Request) {\n  void record({ kind: 'webhook.received', id: req.id });\n  return { status: 202, body: 'received' };\n}\n`,
  'handlers/preferences.ts': `import { updateEntity, type Request } from '../contracts';\nimport { attempt } from '../services/optional';\nexport async function preferences(req: Request) {\n  await updateEntity(req.user, req.body);\n  await attempt({ kind: 'preferences.changed', id: req.id });\n  return { status: 200, body: 'saved' };\n}\n`,
  'handlers/files.ts': `import { render, type Request, type Response } from '../contracts';\nimport { record } from '../services/journal';\nexport async function files(req: Request, response: Response) {\n  const content = await render(req.id);\n  response.send({ status: 200, body: content });\n  await record({ kind: 'file.downloaded', id: req.id });\n}\n`,
  'handlers/profile.ts': `import { updateEntity, type Request } from '../contracts';\nimport { record } from '../services/journal';\nexport async function profile(req: Request) {\n  await updateEntity(req.user, req.body);\n  await record({ kind: 'profile.changed', id: req.id });\n  return { status: 200, body: 'updated' };\n}\n`,
  'handlers/billing.ts': `import { charge, type Request } from '../contracts';\nimport { record } from '../services/journal';\nexport async function billing(req: Request) {\n  await Promise.all([charge(req.id), record({ kind: 'invoice.charged', id: req.id })]);\n  return { status: 201, body: { invoice: req.id } };\n}\n`,
  'handlers/delivery.ts': `import { type Request } from '../contracts';\nimport { deliver } from '../services/dispatch';\nexport async function delivery(req: Request) {\n  const receipt = await deliver({ kind: 'delivery.booked', id: req.id });\n  return { status: 202, body: receipt };\n}\n`,
  'handlers/sessions.ts': `import { type Request } from '../contracts';\nimport { recordSync } from '../services/journal';\nexport function sessions(req: Request) {\n  recordSync({ kind: 'session.created', id: req.id });\n  return { status: 201, body: { session: req.id } };\n}\n`,
  'handlers/enrollment.ts': `import { type Request } from '../contracts';\nimport { withRetry } from '../services/retry';\nexport async function enrollment(req: Request) {\n  await withRetry({ kind: 'member.enrolled', id: req.id });\n  return { status: 201, body: req.user };\n}\n`,
  'handlers/retention.ts': `import { type Request } from '../contracts';\nimport { enqueue } from '../services/outbox';\nexport async function retention(req: Request) {\n  await enqueue({ kind: 'retention.requested', id: req.id });\n  return { status: 202, body: 'queued' };\n}\n`,
  'handlers/health.ts': `export function health() {\n  return { status: 200, body: { healthy: true } };\n}\n`,
  'handlers/metrics.ts': `const counters = new Map<string, number>();\nexport function metrics() {\n  return { status: 200, body: Object.fromEntries(counters) };\n}\n`,
  'handlers/catalog.ts': `import { query, type Request } from '../contracts';\nexport async function catalog(req: Request) {\n  return { status: 200, body: await query(req.body) };\n}\n`,
  'handlers/preview.ts': `import { render, type Request } from '../contracts';\nexport async function preview(req: Request) {\n  const html = await render(req.id);\n  return { status: 200, body: html };\n}\n`,
  'handlers/search.ts': `import { query, type Request } from '../contracts';\nexport async function search(req: Request) {\n  const results = await query(req.body.trim());\n  return { status: 200, body: results.slice(0, 10) };\n}\n`,
  'handlers/locale.ts': `import { type Request } from '../contracts';\nexport function locale(req: Request) {\n  const locale = req.body === 'fr' ? 'fr-FR' : 'en-US';\n  return { status: 200, body: { locale } };\n}\n`,
  'handlers/assets.ts': `const assets: Record<string, string> = { logo: '/static/logo.svg' };\nexport function assetsIndex() {\n  return { status: 200, body: assets };\n}\n`,
  'handlers/version.ts': `export function version() {\n  return { status: 200, body: { version: '2.4.0', protocol: 3 } };\n}\n`,
};
const root = resolve('examples/dispatch');
for (const [path, source] of Object.entries(files)) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), source);
}
const key = {
  fixture: 'dispatch', kind: 'authored development fixture; not production evidence',
  expected: {
    'handlers/orders.ts': { mechanism:'volatile queue', evidence:['services/bus.ts','contracts.ts'] },
    'handlers/refunds.ts': { mechanism:'detached volatile retry', evidence:['services/recovery.ts','contracts.ts'] },
    'handlers/exports.ts': { mechanism:'timer before persistence', evidence:['services/scheduler.ts','contracts.ts'] },
    'handlers/webhook.ts': { mechanism:'unawaited write', evidence:['services/journal.ts','contracts.ts'] },
    'handlers/preferences.ts': { mechanism:'swallowed storage failure', evidence:['services/optional.ts','services/journal.ts','contracts.ts'] },
    'handlers/files.ts': { mechanism:'response precedes awaited write', evidence:['services/journal.ts','contracts.ts'] },
  },
  safe: ['profile','billing','delivery','sessions','enrollment','retention'].map(x=>`handlers/${x}.ts`),
  unrelated: ['health','metrics','catalog','preview','search','locale','assets','version'].map(x=>`handlers/${x}.ts`),
  sources: Object.fromEntries(Object.entries(files).map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])),
};
writeFileSync('eval/dispatch-key.json', JSON.stringify(key, null, 2)+'\n');
console.log(JSON.stringify({ root, files:Object.keys(files).length, handlers:20, goldOutsideCorpus:true }));
