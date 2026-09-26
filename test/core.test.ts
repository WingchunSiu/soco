import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Corpus, symbolLabel } from "../src/corpus.js";
import { askBody, batches, httpTransport, Jev, locateBody, readAnswers, scoreLines } from "../src/jev.js";
import { Runtime } from "../src/runtime.js";
import { runHarness } from "../src/harness.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "soco-test-"));
  await writeFile(join(root, "auth.ts"), "// session cache\r\nexport const allowed = true;\r\n");
  await writeFile(join(root, "unrelated.ts"), "export const color = 'blue';\n");
  return { root, corpus: await Corpus.open(root), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("references omit source; reads preserve CRLF and reject stale IDs", async () => {
  const f = await fixture();
  try {
    const refs = await f.corpus.blocks("auth.ts");
    assert.equal("text" in refs[0]!, false);
    assert.equal((await f.corpus.read(refs[0]!.id)).text, "// session cache\r\nexport const allowed = true;\r\n");
    await writeFile(join(f.root, "auth.ts"), "changed\n");
    await assert.rejects(f.corpus.read(refs[0]!.id), /changed/);
    const next = await f.corpus.blocks("auth.ts");
    assert.notEqual(next[0]!.id, refs[0]!.id);
  } finally { await f.cleanup(); }
});

test("all source lines covered and empty files work", async () => {
  const f = await fixture();
  try {
    const source = Array.from({ length: 145 }, (_, i) => `line ${i}\n`).join("");
    await writeFile(join(f.root, "large.txt"), source);
    const refs = await f.corpus.blocks("large.txt");
    assert.deepEqual(refs.map(r => [r.start, r.end]), [[1, 60], [61, 120], [121, 145]]);
    assert.equal((await Promise.all(refs.map(r => f.corpus.source(r.id)))).map(r => r.text).join(""), source);
    await writeFile(join(f.root, "empty.txt"), "");
    assert.deepEqual(await f.corpus.blocks("empty.txt"), []);
  } finally { await f.cleanup(); }
});

test("source API excludes dotenv, traversal and symlinks", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, ".env"), "DO_NOT_READ=test");
    await symlink(join(f.root, ".env"), join(f.root, "alias.txt"));
    assert.deepEqual(await f.corpus.files(), ["auth.ts", "unrelated.ts"]);
    await assert.rejects(f.corpus.blocks(".env"), /excluded/);
    await assert.rejects(f.corpus.blocks(".."), /outside/);
    await assert.rejects(f.corpus.blocks("alias.txt"), /Symlinks/);
  } finally { await f.cleanup(); }
});

test("filter sends actual source, preserves unknowns, tracks usage and enforces request budget", async () => {
  const f = await fixture();
  try {
    const refs = await f.corpus.blocks();
    const jev = new Jev(f.corpus, async body => {
      assert.match(JSON.stringify(body.questions), /session cache/);
      return { answers: { [refs[0]!.id]: { noul: 0.1 }, [refs[1]!.id]: { noul: "0.9" } }, usage: { input_tokens: 100, output_tokens: 3 } };
    }, "test", 1);
    const pick = await jev.filter(refs, "Investigate logout");
    assert.equal(pick.unknown, 1);
    assert.equal(pick.matches[0]!.id, refs[1]!.id);
    assert.equal(pick.matches[0]!.probability, null);
    assert.equal(pick.belowThreshold, 1);
    assert.equal(jev.metrics.inputTokens, 100);
    await assert.rejects(jev.filter(refs, "Again"), /budget/);
  } finally { await f.cleanup(); }
});

test("batches obey byte and question limits, even for multibyte text", () => {
  const blocks = Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, path: "source.txt", sha256: "x", start: i + 1, end: i + 1, chars: 5000, text: "中".repeat(5000) }));
  const bodies = batches(blocks, "Find evidence", "test");
  assert.equal(bodies.reduce((n, b) => n + Object.keys(b.questions).length, 0), 30);
  for (const b of bodies) assert.ok(Buffer.byteLength(JSON.stringify(b)) <= 24000);
  assert.throws(() => batches([{ ...blocks[0]!, text: "中".repeat(10000) }], "question", "test"), /24 KB/);
});

test("concurrent filters cannot overspend request reservations", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const jev = new Jev(f.corpus, async () => { calls++; return { answers: {} }; }, "test", 1);
    const refs = await f.corpus.blocks();
    const results = await Promise.allSettled([jev.filter(refs, "a"), jev.filter(refs, "b")]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("HTTP adapter uses documented wire format and does not expose error bodies", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer TEST_ONLY");
      assert.equal(init!.redirect, "error");
      return new Response("secret diagnostic body", { status: 401 });
    };
    await assert.rejects(httpTransport("TEST_ONLY")({ model: "test", state: { query: "x" }, questions: {} }), error => {
      assert.equal((error as Error).message, "Jev HTTP 401; no judgment was made");
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("symbol lines are declaration-only and locate returns scores without source text", async () => {
  const f = await fixture();
  const runtime = new Runtime(f.corpus, new Jev(f.corpus, async body => {
    const lines = String((body.state as { numbered_lines: string }).numbered_lines);
    assert.match(lines, /^L00\| /m);
    assert.equal((body.questions as { where: { type: string } }).where.type, "choice");
    assert.equal((body.questions as { present: { type: string } }).present.type, "noul");
    return {
      answers: {
        where: { type: "choice", choice: "L00", probabilities: { L00: 0.8, L01: 0.2 }, confidence: 0.6 },
        present: { type: "noul", noul: 0.91 },
      },
      usage: { input_tokens: 40, output_tokens: 8 },
    };
  }));
  try {
    assert.equal(symbolLabel("export function logout(id: string): void {"), "logout");
    assert.equal(symbolLabel("  if (revoked.has(id)) return false;"), null);
    const listed = await runtime.eval('state.decls = await repo.symbols("."); print(state.decls);');
    assert.match(listed.output, /allowed/);
    assert.doesNotMatch(listed.output, /session cache/);
    const located = await runtime.eval('state.hit = await jev.locate("where is logout handled?", [state.decls]); print(state.hit);');
    assert.match(located.output, /probability: 0\.8/);
    assert.doesNotMatch(located.output, /export const allowed/);
    const opened = await runtime.eval('print(await repo.lines(state.hit.spans.slice(0, 1), 1));');
    assert.match(opened.output, /export const allowed/);
  } finally { runtime.close(); await f.cleanup(); }
});

test("ask sends one material with several questions and keeps malformed answers unknown", async () => {
  const f = await fixture();
  try {
    const jev = new Jev(f.corpus, async body => {
      assert.equal((body.state as { material: { path: string } }).material.path, "auth.ts");
      assert.equal(Object.keys(body.questions).length, 2);
      return { answers: { relevant: { type: "noul", noul: 0.8 }, start: { type: "choice" } }, usage: { input_tokens: 10, output_tokens: 2 } };
    }, "test", 1);
    const result = await jev.ask({ path: "auth.ts", text: "export const allowed = true;" }, {
      relevant: { type: "noul", instructions: "Could this help?" },
      start: { type: "choice", instructions: "Which line?", criteria: { L0: "allowed", none: "none" } },
    });
    assert.equal(result.answers.relevant!.probability, 0.8);
    assert.deepEqual(result.unknown, ["start"]);
    assert.throws(() => askBody("x", {}, "test"), /1 to 16/);
    const parsed = readAnswers({ answers: {} }, ["missing"]);
    assert.deepEqual(parsed.unknown, ["missing"]);
  } finally { await f.cleanup(); }
});

test("a malformed locate response stays unknown instead of becoming a score", () => {
  const lines = Array.from({ length: 3 }, (_, i) => ({ id: `L0${i}`, text: "ok" }));
  const body = locateBody(lines, "which line?", "test");
  assert.equal(Object.keys((body.questions.where as { criteria: object }).criteria).length, 3);
  const scored = scoreLines([{ id: "L00", path: "a.ts", start: 4, end: 4 }], { answers: { where: { probabilities: {} }, present: { noul: "bad" } } });
  assert.equal(scored.unknown, 1);
  assert.equal(scored.present, null);
  assert.equal(scored.views[0]!.view, 0);
});

test("code environment persists state and keeps bodies out until explicitly read", async () => {
  const f = await fixture();
  const runtime = new Runtime(f.corpus);
  try {
    const first = await runtime.eval('state.refs = await repo.blocks("auth.ts"); print(state.refs); state.n = 7;');
    assert.equal(first.error, undefined);
    assert.doesNotMatch(first.output, /export const/);
    const second = await runtime.eval('print(state.n); print(await repo.read(state.refs[0]));');
    assert.match(second.output, /7/);
    assert.match(second.output, /export const allowed/);
    const baseline = await runtime.eval('print(typeof jev);');
    assert.equal(baseline.output.trim(), "undefined");
  } finally { runtime.close(); await f.cleanup(); }
});

test("output truncation explicit; asynchronous hang terminates session", async () => {
  const f = await fixture();
  const runtime = new Runtime(f.corpus, undefined, 200);
  try {
    const big = await runtime.eval('print("x".repeat(20000));');
    assert.equal(big.output.trim().length, 1612);
    assert.match(big.output, /truncated/);
    assert.equal(big.truncated, true);
    const hung = await runtime.eval('await new Promise(() => {});');
    assert.match(hung.error!, /timed out/);
    await assert.rejects(runtime.eval('print("again");'), /closed/);
  } finally { runtime.close(); await f.cleanup(); }
});

test("harness recovers invalid actions, feeds observations back, then finalizes", async () => {
  const f = await fixture();
  const runtime = new Runtime(f.corpus);
  try {
    let step = 0;
    const result = await runHarness({ task: "Inspect auth", runtime, mode: "read", maxSteps: 4, root: {
      complete: async (_system, messages) => {
        if (step++ === 0) return { text: "not JSON" };
        if (step === 2) return { text: JSON.stringify({ action: "code", code: 'state.refs = await repo.blocks("auth.ts"); print(await repo.read(state.refs[0]));' }) };
        assert.match(messages.at(-1)!.content, /export const allowed/);
        return { text: JSON.stringify({ action: "final", answer: "auth.ts:2 contains the declaration." }) };
      },
    } });
    assert.equal(result.status, "completed");
    assert.equal(result.steps, 3);
  } finally { runtime.close(); await f.cleanup(); }
});

test("step exhaustion is not reported as success", async () => {
  const f = await fixture();
  const runtime = new Runtime(f.corpus);
  try {
    const result = await runHarness({ task: "inspect", runtime, mode: "read", maxSteps: 1, root: {
      complete: async () => ({ text: JSON.stringify({ action: "code", code: 'print(await repo.files());' }) }),
    } });
    assert.equal(result.status, "budget_exhausted");
    assert.equal(result.answer, null);
  } finally { runtime.close(); await f.cleanup(); }
});
