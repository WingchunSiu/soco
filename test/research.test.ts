import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutputBudget, render } from "../src/output.js";
import { Corpus } from "../src/corpus.js";
import { readAnswers, askBody } from "../src/jev.js";
import { Runtime } from "../src/runtime.js";

test("native REPL persists helpers and returns runtime errors without hanging", async () => {
  const corpus = await Corpus.open("examples/repo");
  const runtime = new Runtime(corpus, undefined, 1000);
  try {
    assert.equal((await runtime.eval('const n = await Promise.resolve(7); function plus(x) { return x + n; }')).error, undefined);
    assert.equal((await runtime.eval('print(plus(3));')).output, '10\n');
    const missing = await runtime.eval('notDefined.split("x");');
    assert.match(missing.error!, /notDefined/);
    assert.doesNotMatch(missing.error!, /timed out/);
    assert.equal((await runtime.eval('const n = 9;')).error, undefined);
    assert.equal((await runtime.eval('print(plus(4));')).output, '13\n');
    assert.match((await runtime.eval('{ const local = 1; local = 2; }')).error!, /constant/);
  } finally { runtime.close(); }
});

test("output budget is cumulative, per-cell, atomic, and reports only real omissions", () => {
  const budget = new OutputBudget(2500, 1800);
  budget.emit("x".repeat(600));
  assert.equal(budget.rejectedChars, 0);
  budget.emit("x".repeat(1400));
  assert.equal(budget.output.length, 600);
  assert.equal(budget.rejectedChars, 1400);
  budget.resetCell(); budget.emit("y".repeat(1800));
  assert.equal(budget.used, 2400);
  budget.resetCell(); budget.emit("too long".repeat(20));
  assert.equal(budget.output, "");
  assert.equal(budget.status().remaining, 100);
});

test("AST scopes, versioned windows and accounting survive alternative read paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "soco-ast-"));
  try {
    const source = 'export function f() {\n  const nested = 2;\n  return nested;\n}\nexport const arrow = () => {\n return 1;\n};\n';
    await writeFile(join(root, "file.ts"), source);
    const repo = await Corpus.open(root);
    const symbols = await repo.symbols();
    assert.deepEqual(symbols.map(s => [s.label,s.start,s.end]), [["f",1,4],["arrow",5,7]]);
    const view = await repo.window("file.ts", 1, 7);
    assert.ok(repo.metrics.sourceCharsReturned > 0);
    assert.equal(repo.metrics.windowCalls, 1);
    assert.equal((await repo.lines([symbols[0]!]))[0]!.text, source.split('\n').slice(0,4).join('\n')+'\n');
    await writeFile(join(root,"file.ts"), '// inserted\n'+source);
    await assert.rejects(repo.lines([view.lines[0]!]), /source changed/);
    const other = await repo.window("file.ts",2,3);
    assert.notEqual(view.lines[0]!.id, other.lines[0]!.id);
  } finally { await rm(root, {recursive:true,force:true}); }
});

test("full probabilities remain external for programmatic filtering", () => {
  const probabilities = { a: .3, b: .25, c: .2, d: .15, e: .1 };
  const result = readAnswers({answers:{ q:{type:"choice",choice:"a",probabilities} }}, ["q"]);
  assert.deepEqual(result.answers.q!.probabilities, probabilities);
});

test("batch questions must not rely on output keys to select records", () => {
  const q = {type:"noul", instructions:"Did verification succeed?"};
  assert.throws(() => askBody({a:"passed",b:"failed"},{a:q,b:q},"jev-latest"), /Question IDs do not select records/);
  assert.doesNotThrow(() => askBody({a:"passed",b:"failed"},{a:{...q,instructions:"For material.a: did verification succeed?"},b:{...q,instructions:"For material.b: did verification succeed?"}},"jev-latest"));
});

test("source printing is compact without changing stored versioned evidence", () => {
  const span = {path:"a.ts",start:2,end:2,text:"return value;",sha256:"hash"};
  assert.equal(render({path:"a.ts",lines:[span]}), "FILE a.ts\n2|return value;");
  assert.equal(render([span]), "FILE a.ts\n2|return value;");
  assert.equal(render({path:"a.ts",start:4,end:5,text:"first\r\nsecond\r\n"}), "FILE a.ts\n4|first\n5|second");
  assert.equal(span.sha256, "hash");
});

test("throwing source cannot bypass the output budget", async () => {
  const corpus = await Corpus.open("examples/repo");
  const runtime = new Runtime(corpus, undefined, 1000, () => {}, 20, 20);
  try {
    await runtime.eval('print("0123456789");');
    const result = await runtime.eval('throw new Error("secret source text repeated beyond remaining budget");');
    assert.doesNotMatch(result.error!, /secret source/);
    assert.match(result.error!, /exceed/);
    assert.ok(result.budget!.rejectedChars > 0);
    assert.equal((await runtime.eval('throw "oops";')).error?.includes("oops"), true);
    assert.ok((await runtime.eval('print(budget().used);')).budget!.used <= 20);
  } finally { runtime.close(); }
});
