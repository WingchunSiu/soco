# SOCO

System One context offloading. A root model investigates a repository by writing code. Source stays in that code environment. Jev judges the pieces the code sends it and returns probabilities, not an explanation. Only what the code prints comes back into the root model's context.

The hypothesis is that cheap semantic judgments can reduce root reading and leave room for the rest of the investigation. Savings depend on the root choosing useful questions and avoiding redundant printing. A strong root may solve the same task by direct reading or deterministic code. Jev scores are fallible; this is not a correctness-preserving speculative-decoding algorithm. See [the experiment report](eval/REPORT-2026-09-26.md) for the initial experiments and [the semantic-composition PoC](eval/POC-2026-09-26.md) for the subsequent implementation and five live development runs. Open [the animated explanation](demo/index.html) or [the detailed trace viewer](demo/inspect.html) locally.

The current scope is read-only investigation. It does not edit, run, or test the repository it is reading.

## Loop

The harness owns the outer loop. It does not hard-code the investigation.

```text
while (steps remain) {
  action = root model(system prompt, history)
  if action is final: return the answer
  observation = run the JavaScript
  history.append(action, observation)
}
```

Each turn is one JSON action:

```json
{"action":"code","code":"..."}
```

or:

```json
{"action":"final","answer":"..."}
```

This is a small autonomous harness with a CLI entry point. A native Node REPL persists `state`, top-level bindings, and helper functions; top-level await works. Notebook-style top-level variable declarations (`let`/`const`) are converted to `var` so cells can be rerun. Nested lexical scopes keep ordinary JavaScript semantics. Original and transformed code are retained in traces. Source stays external until printed. Error details also return to the root and count against the output budget.

## What the code can call

| Call | What it does |
|---|---|
| `repo.files`, `repo.symbols`, `repo.blocks`, `repo.search` | List, index, and search without returning whole files |
| `repo.window`, `repo.lines`, `repo.read` | Load original text when a span is actually needed |
| `jev.map(records, questions, context?)` | Apply generic questions to each record; automatically bind targets and pack bounded requests |
| `jev.ask(material, questions)` | Ask up to 16 independent questions about one material |
| `jev.locate`, `jev.filter` | Rank candidate locations, or screen blocks with recoverable originals |

`jev.ask` is the general action. The root model writes the questions. The code chooses the material. A question is a `noul`, a `choice`, or a `score`. A choice can select only an option the code listed. The scores stay in `state` until the code prints the ones it will branch on. They route the next read. They are not the evidence in the final answer.

Literal search and direct reads stay available. A missed judgment can still be recovered by opening the source.

## Run

Node.js 22+.

```sh
npm ci --ignore-scripts
npm test
npm run demo
```

Copy `.env.example` to `.env` in this directory. `TYPESAFE_API_KEY` is enough for a Jev call. `run` also needs `ROOT_PROVIDER`, `ROOT_MODEL`, and `ROOT_API_KEY`. Configuration is loaded from this project, not from the repository under investigation. Keys stay out of prompts and out of the code child process.

```sh
npm run jev -- select --root examples/repo --query 'Which code could explain a session remaining valid after logout?'
npm run jev -- run --root examples/repo --task 'Why can a session remain valid after logout? Cite files and line ranges.'
```

`--mode read` runs the same loop without Jev. Both modes share a cumulative `--output-budget 16000` and per-cell `--cell-budget 6000` character cap. These cover emitted text and error details, not system prompts, code history, or fixed status metadata; total root token usage is logged separately. Oversized emissions are rejected atomically, with remaining budget reported. `--require-jev` requires a semantic call before final as a controlled experiment; it does not prove useful offloading. Adaptive use is the default. `demo` is scripted and offline, not model evidence.

A live call sends candidate text to TypeSafe. The child process limits stuck execution. It is not a sandbox for hostile code.

## Choosing context and operations

Known names/literals: search and read directly. Many semantically different records: use `jev.map` with generic per-record questions, keep full results external, print compact IDs/scores, then inspect uncertain cases and sample positives/negatives. Related code: start with a coherent function or small set of related functions, including needed definitions; isolated lines often omit the evidence required to answer. There is no fixed retrieve-rank-read pipeline.

`repo.symbols` returns complete TS/JS AST ranges with declaration-only text. Other languages use a declaration-line fallback. `repo.window` loads up to 400 lines without automatically printing them. `repo.lines` requires versioned spans and rejects changed source. All read paths contribute to source accounting.

For `jev.ask`, question IDs use lowercase snake case (up to 41 characters); map filenames to `q0`, `q1`, etc. Output IDs do not bind a question to a record: explicitly name the record in each instruction. Exact duplicate definitions over shared material are rejected locally. `ask` permits 16 independent questions, instructions up to 800 characters, and a local 24 KB serialized request limit. This is an implementation limit, not Jev's advertised context capacity. Send compact ID-to-text material instead of repeating per-line hashes. A Choice picks among supplied options; use independent Nouls for multiple possible matches. Keep uncertain/missing results; thresholding is not a completeness guarantee.

`jev.map` keeps original record IDs and allows 1–256 records, 1–8 generic questions, and string criteria up to 2,000 characters. It applies **every question to every record**; shared definitions belong in the third `context` argument. The host binds each question to its target and splits requests at 16 judgments or 24 KB. All input is preflighted and the request budget reserved before sending. Full distributions stay in the result; missing answers are listed in `unknown`. Partial transport failure preserves completed items and distinguishes `failed` from `not_attempted`; it never turns missing answers into zero probability. Explicit per-record addressing in string templates is rejected; this guard cannot detect every semantic misuse.

```js
state.screen = await jev.map(state.records, {
  relevant: { type: "noul", instructions: "Does this record delegate an audit write?" }
}, state.contracts);
// Root-written code selects candidates, loads dependencies, and composes another map.
// Print only useful observations; review numbered original source before final diagnosis.
```

Printing a source object produces a `FILE path` header followed by `line|text`. The object and its versioned references remain intact in state. Loading source alone does not expose it to root.

Trace files under ignored `runs/` include questions, material, scores, original printed observations, errors, and provider usage. They may contain source code. Failed runs retain trace paths and mark usage potentially incomplete. A `completed` run means the model returned a final answer, not that the answer passed evaluation.

## Reproduce the experiments

```sh
npm run build
node eval/scripts/prepare.mjs
node eval/scripts/holdout.mjs
# Public source control (only read; no dependencies or source code executed):
git clone https://github.com/encode/httpx.git work/httpx
git -C work/httpx checkout --detach 26d48e0634e6ee9cdc0533996db289ce4b430177
node eval/scripts/run.mjs episodes-holdout read adaptive local 8000
node eval/scripts/run.mjs episodes-holdout jev offload local 8000
node eval/scripts/probe.mjs
node eval/scripts/summarize.mjs
```

Live commands use the project credentials and incur API costs. `offload` is an explicit task-level experimental instruction to delegate bulk judgments; it is separate from default adaptive use and `required` (one mandatory call). The model still writes its own code, partitions, questions, and follow-up reads. The synthetic keys remain outside the agent corpus. Rerunning `prepare.mjs` recreates the original task manifest; run `holdout.mjs` afterward.

Design references: [Prime Agent RLM runtime](https://github.com/PrimeIntellect-ai/prime-agent/blob/cd1f215cffd09223316c54dddae5e1b654718c31/packages/coding-agent/docs/rlm-runtime.md), [Prime Agent prompting](https://github.com/PrimeIntellect-ai/prime-agent/blob/cd1f215cffd09223316c54dddae5e1b654718c31/packages/coding-agent/src/core/prompts/rlm.ts), [RLM minimal](https://github.com/alexzhang13/rlm-minimal). Jev: [models](https://docs.typesafe.ai/models), [known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Semantic-composition proof of concept

The Dispatch fixture has 20 handlers and 8 helper modules. Its answer key is outside the agent corpus. The instructed profile preloads raw handlers and contracts into external state; root still writes questions, selects candidates, composes dependency context, reviews source, and writes the final diagnosis. It intentionally specifies use of offloading. It does not test autonomous tool adoption or establish a cost advantage.

```sh
npm run build
# Recreates the authored fixture and its key:
node eval/scripts/prepare-investigation.mjs
# Live API run; use a new label (existing runs are protected):
node eval/scripts/poc-seeded.mjs my-run
# Offline: export its recorded trace into a self-contained HTML replay:
node eval/scripts/export-poc.mjs runs/poc/dispatch-jev-my-run.json
```

The checked-in `demo/index.html` already contains the final development run and needs no server, credentials, or API calls. The replay separates source stored outside root, numeric judgments, and numbered source actually printed to root. It preserves original model text, including its limitations; it is an illustration based on a real run over authored data, not an independently held-out evaluation.
