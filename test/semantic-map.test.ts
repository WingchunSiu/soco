import test from "node:test";
import assert from "node:assert/strict";
import { Corpus } from "../src/corpus.js";
import { Jev } from "../src/jev.js";
import { mapBatches } from "../src/semantic-map.js";
import { Runtime } from "../src/runtime.js";

const questions = { candidate: { type: "noul", instructions: "Could this handler acknowledge before its audit is durable?" },
  missing: { type: "noul", instructions: "Does deciding audit durability require an absent helper definition?" } };

test("map rejects per-record addressing before traffic but accepts complete generic criteria", () => {
  assert.throws(() => mapBatches({a:"a"}, {q:{type:"noul",instructions:"Using material.h1 and helpers: is it durable?"}}, undefined, "test"), /EVERY/);
  assert.doesNotThrow(() => mapBatches({a:"a"}, {q:{type:"noul",instructions:"For this record: " + "complete rule. ".repeat(70)}}, undefined, "test"));
  const batches = mapBatches({a:"a"}, {needsHelper:{type:"noul",instructions:"Is a helper missing?"}}, undefined, "test");
  assert.equal(batches[0]!.bindings[0]!.question, "needsHelper");
});

test("map binds all independent questions, packs by count/UTF-8 bytes, and keeps opaque IDs", () => {
  const records = Object.fromEntries([...Array.from({ length: 18 }, (_, i) => [`handlers/${i}.ts`, "中".repeat(1200)]), ["__proto__", "source"]]);
  const batches = mapBatches(records, questions, "shared contract", "test");
  const bindings = batches.flatMap(b => b.bindings);
  assert.equal(bindings.length, 38);
  assert.deepEqual([...new Set(bindings.map(b => b.record))], Object.keys(records));
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify(batch.body)) <= 24000);
    assert.ok(Object.keys(batch.body.questions).length <= 16);
    for (const b of batch.bindings) {
      const q = batch.body.questions[b.wire] as { instructions: { target: string; question: string } };
      const target = q.instructions.target.match(/material\.records\.(r\d+)/)![1]!;
      const state = batch.body.state as { material: { records: Record<string, string>; context: string } };
      assert.equal(state.material.records[target], records[b.record]);
      assert.equal(state.material.context, "shared contract");
      assert.equal(q.instructions.question, questions[b.question as keyof typeof questions].instructions);
    }
  }
});

test("map preflight rejects oversized later records and reserves whole plan before traffic", async () => {
  let calls = 0;
  const corpus = await Corpus.open("examples/repo");
  const jev = new Jev(corpus, async () => { calls++; return { answers: {} }; }, "test", 1);
  await assert.rejects(jev.map({ small: "okay", big: "中".repeat(10000) }, questions), /24 KB/);
  assert.equal(calls, 0);
  await assert.rejects(jev.map(Object.fromEntries(Array.from({length: 9}, (_, i) => [String(i), "x"])), questions), /budget/);
  assert.equal(calls, 0);
  const concurrent = await Promise.allSettled([jev.map({ a: "a" }, questions), jev.map({ b: "b" }, questions)]);
  assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
});

test("map retains original IDs, full distributions and missing judgments", async () => {
  const corpus = await Corpus.open("examples/repo");
  const jev = new Jev(corpus, async () => ({ answers: {
    q0_0: { type: "choice", choice: "a", probabilities: { a:.3, b:.25, c:.2, d:.15, e:.1 } },
    q1_0: { type: "choice" },
  } }), "test");
  const result = await jev.map(Object.fromEntries([["a.ts", "a"], ["__proto__", "b"]]), {
    route: { type: "choice", instructions: "Which option?", criteria: {a:"a",b:"b",c:"c",d:"d",e:"e"} },
  });
  assert.deepEqual(result.items["a.ts"]!.answers.route!.probabilities, { a:.3, b:.25, c:.2, d:.15, e:.1 });
  assert.deepEqual(result.unknown, [{record:"__proto__",question:"route"}]);
  assert.equal(jev.metrics.unknownUsageRequests, 1);
});

test("map returns partial results and distinguishes failed from unattempted records", async () => {
  const corpus = await Corpus.open("examples/repo");
  let calls = 0;
  const jev = new Jev(corpus, async body => {
    if (++calls === 2) throw new Error("network failed");
    return { answers: Object.fromEntries(Object.keys(body.questions).map(q => [q, {type:"noul",noul:.8}])) };
  }, "test");
  const result = await jev.map(Object.fromEntries(Array.from({length:17}, (_, i) => [`r${i}`, "source"])), questions);
  assert.equal(result.items.r0!.status, "completed");
  assert.equal(result.items.r8!.status, "failed");
  assert.equal(result.items.r16!.status, "not_attempted");
  assert.equal(result.unknown.length, 18);
  assert.equal(result.requests, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(jev.metrics.unknownUsageRequests, 2);
});

test("REPL semantic map stays external until printed and can drive a subsequent source read", async () => {
  const corpus = await Corpus.open("examples/repo");
  const runtime = new Runtime(corpus, new Jev(corpus, async body => ({
    answers: Object.fromEntries(Object.keys(body.questions).map(q => [q, {type:"noul",noul:.9}])),
  })));
  try {
    const first = await runtime.eval('state.refs = await repo.blocks("auth.ts"); state.source = await repo.read(state.refs[0]); state.scores = await jev.map({"auth.ts":state.source.text},{relevant:{type:"noul",instructions:"Does this handle sessions?"}});');
    assert.equal(first.error, undefined);
    assert.equal(first.output, "");
    const second = await runtime.eval('if (state.scores.items["auth.ts"].answers.relevant.probability > .5) print(await repo.read(state.refs[0]));');
    assert.equal(second.error, undefined);
    assert.match(second.output, /FILE auth.ts/);
    assert.equal(runtime.calls, 1);
  } finally { runtime.close(); }
});
