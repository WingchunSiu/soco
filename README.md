# SOCO

System One context offloading. The root model decides the investigation. Jev makes fast, cheap judgments over source that stays in the code environment. The aim is less source in the root context, so the investigation uses fewer root tokens and costs less. It does not promise a more accurate answer than reading the source directly. Accuracy is a constraint, not the thing being optimized.

This is a TypeScript research prototype. The current scope is read-only investigation and answering. It is not yet an agent that edits, runs, and tests code.

It includes a system prompt, persistent state, code-execution feedback, the root loop, and a Jev HTTP adapter. The CLI is the entry point. It has not shown a token, cost, or speed advantage.

## Start

Requires Node.js 22+. A local Node 22 binary is at `/Users/michaelx/.nvm/versions/node/v22.16.0/bin/node`; the default shell may still be Node 20. Set PATH for the session instead of changing the global default:

```sh
export PATH=/Users/michaelx/.nvm/versions/node/v22.16.0/bin:$PATH
cd /Users/michaelx/research/soco
npm ci --ignore-scripts
npm test
npm run demo
```

The first setup installed dependencies, built the project, and created an empty `.env`. Later reinstalls are the only reason to run `npm ci` again. `demo` stays offline: the root actions are scripted, and Jev is a keyword mock. It checks plumbing only. Its answer is explicitly marked MOCK.

## Configuration

Edit `.env` in this project root. One value is enough to test real Jev:

```dotenv
TYPESAFE_API_KEY=your-key
JEV_MODEL=jev-latest
```

Configuration always loads from the project directory, never from the repository being investigated. Existing process environment variables win. Keys are not placed in prompts, request logs, or the code-execution child process. `.env` and `runs/` are gitignored. The template is `.env.example`.

A real `select`, `jev.filter`, `jev.locate`, or `jev.ask` sends candidate text and the question to TypeSafe and consumes API usage. Reads stay inside the given `--root` and supported text extensions. Path filters exclude dotfiles, common generated directories, explicit credential filenames, and symlinks. This is not a general secret detector.

The autonomous root loop also needs:

```dotenv
ROOT_PROVIDER=xai
ROOT_MODEL=grok-4.7
ROOT_API_KEY=the-provider-key
```

```sh
npm run jev -- models --provider xai
```

The root adapter uses the pinned `@mariozechner/pi-ai` 0.73.1. It does not read or reuse a personal Pi login. Upstream has since been renamed `@earendil-works/pi-ai`; this prototype stays on the verified interface, and a later migration only needs `src/root.ts`. The Pi coding agent is not required. Other providers can be selected through the same adapter, but they have not been tested here.

The current root endpoint is the official xAI endpoint `https://api.x.ai/v1`, model id `grok-4.7`. The older SDK catalog does not include that model, so `src/root.ts` adds the definition instead of substituting another Grok version. `ROOT_API_KEY` should be a native xAI key. A third-party gateway key needs the matching provider and endpoint. The 4096 in the model definition is this prototype's output cap. Cost estimates use the published standard-context price and are not valid for the high-context price above 200K input tokens. [Model reference](https://docs.x.ai/developers/models/grok-4.7)

## Three live entry points

### 1. Inspect a Jev selection by itself

```sh
npm run jev -- select \
  --root examples/repo \
  --query 'Which code could explain a session remaining valid after logout?'
```

The output has each block's probability, candidate references, unknown scores, usage, and the trace path. This command only screens. It does not read source into the caller and does not call the root model. Use `--path src/auth` to narrow the range. `--mock` tests the interface only and cannot be used to judge quality.

### 2. Persistent code session

A Jev key is enough. No root-model key is required.

```sh
npm run jev -- session --root examples/repo
```

Each input line is one JSON object, and each result is one JSON line. For example:

```json
{"code":"state.refs = await repo.blocks('.'); print(state.refs);"}
{"code":"state.pick = await jev.filter(state.refs, 'Which code could explain a session remaining valid after logout?'); print(state.pick.matches);"}
{"code":"for (const ref of state.pick.matches) print(await repo.read(ref));"}
```

Another agent can drive this process. For machine calls, use `node dist/src/cli.js session ...` so npm startup text does not mix into stdout. Diagnostics and the trace path go to stderr. EOF on stdin closes the session.

### 3. Root model investigates

```sh
npm run jev -- run \
  --root examples/repo \
  --task 'Why can a session remain valid after logout? Cite files and line ranges.' \
  --mode jev --max-steps 12
```

The root model receives the environment description and examples, then emits `code` or `final` actions. Bounded output from each cell is fed back. `completed` means the model emitted a final answer. It does not mean the answer was scored or verified. Running out of steps returns `budget_exhausted` and exit code 2. A request error uses exit code 1.

The no-Jev baseline:

```sh
npm run jev -- run \
  --root examples/repo \
  --task 'Why can a session remain valid after logout? Cite files and line ranges.' \
  --mode read --max-steps 12
```

Both modes share the root adapter, source reads, literal search, and execution loop. Read mode has no `jev` object and no Jev examples. Equal step budgets are not equal cost. A later comparison needs to match budgets on measured usage.

## Code environment

Cells run JavaScript. The implementation language is TypeScript. Each cell may use `await`. Values that must survive go on `state`. A cell-local `let` or `const` does not survive. There is no arbitrary module import or shell API.

| Operation | Returns |
|---|---|
| `await repo.files(path)` | Relative file paths |
| `await repo.symbols(path)` | Declaration lines `{id,path,start,end,label,text}`, declaration line only |
| `await repo.blocks(path)` | `{id,path,sha256,start,end,chars}` references, no source text |
| `await repo.search(literal, path)` | Block references containing the literal, at most 100, truncation marked |
| `await repo.window(path, start, end)` | Numbered window of at most 80 lines, kept in the code environment, not printed automatically |
| `await jev.ask(material, questions)` | Up to 16 independent judgments over one material; probabilities, not an explanation |
| `await jev.filter(refs, question, threshold?)` | Block screening: matches, judgments, unknown, belowThreshold |
| `await jev.locate(question, views)` | Shortcut: a line Choice plus a present Noul |
| `await repo.lines(spans, padding?)` | Original text for spans already held, padding 0..8 |
| `await repo.read(ref, padding?)` | Original text, 1-based line range, and content hash, preserving newlines |
| `print(value)` | The only output returned to the root model |

`jev.ask` is the general action. The root model writes the questions. Code decides which material is sent. One request carries up to 16 questions that cannot see one another's answers. Types are `noul`, `choice`, and `score`. A Choice can select only an option the code listed, so include `none` when nothing may fit. Keep the result on `state` and print only the probabilities used for the next branch. `locate` remains the shortcut for pointing at a line. `filter` remains whole-block rejection. Jev does not write an explanation and does not guarantee complete recall.

On 2026-09-25, two direct `locate` calls were made against the three-file fixture. They were not an autonomous investigation. The declaration-line request returned `present` 0.87, probability 0 for `greeting`, and the remaining probability on `logout`, `isAllowed`, `allowCache`, and `revoked`. Numbering the 13 lines of `auth.ts` and asking again returned `present` 0.97, with 0.97 on the `allowCache.has` line and the rest near 0. That shows the action can point at a line. It does not show that the root model will take that path, and it is not a comparison.

Symbol extraction is a regular expression, not a parser. Missed declarations remain reachable through `repo.search` and `repo.read`. `filter` can drop clearly unrelated files first. It does not say which line matters.

A cell can hold a window and ask several questions without printing the source:

```js
state.view = await repo.window("auth.ts", 1, 40);
state.judge = await jev.ask(state.view.lines, {
  cache_before_revoke: { type: "noul", instructions: "Does a cache check return before a revocation check?" },
  logout_clears_cache: { type: "noul", instructions: "Does logout remove the allow cache entry?" }
});
print(state.judge.answers);
```

`filter` generates question ids itself and puts the real source text in `instructions.source_block`. Sending only an id is not enough. The default threshold 0.35 is not tuned. A missing or illegal score is recorded as unknown and kept in the candidate set. References for low-scoring blocks remain in `judgments`. A score never guarantees complete evidence. The root model can still read any registered block.

## Layout

```text
src/corpus.ts       File scope, chunking, versioned refs, source reads, literal search
src/jev.ts          HTTP API, Noul batches, ask/locate, usage and request budget
src/cell-worker.ts  Code environment, state, print, host RPC
src/runtime.ts      Child-process lifetime, execution feedback, timeout
src/prompt.ts       Root operating instructions, policy, and examples
src/harness.ts      Model, code, observation, model loop
src/root.ts         Root-provider adapter
src/cli.ts          Config loading, entry points, trace
src/mock.ts         Explicitly marked offline fake
test/core.test.ts   Protocol and behavior tests
examples/repo/      Hand-built cross-file auth/cache bug
examples/booking/   Hand-built cancel/expiry fixture used for the 2026-09-25 probe
eval/               Predictions and probe notes, not part of an investigated corpus
runs/               Local JSONL traces (gitignored)
```

## Records and limits

- A trace records the actual system prompt, task, root replies, code, observations, Jev candidate ids, scores, usage, and elapsed time. It can contain source that was read. Do not upload these logs by default.
- Root usage includes token and cache statistics returned by the SDK, plus an estimated cost. Jev keeps the token usage the API returned. There is no hardcoded Jev price. Missing usage is recorded as unknown, not inferred to be zero.
- `sourceCharsReturned` counts characters returned from source files into the code environment. `observationChars` counts characters printed to the root model. Neither is a token count, and neither is the model's actual reading. Use root API usage for that.
- `requestsReserved` is the allowance reserved for a whole batch. `requests` counts transport calls actually attempted. Unused reservation after a failure is not refunded, so an implicit retry cannot spend extra money quietly.
- Defaults are 12 root calls and 20 Jev requests per investigation. A cell also has 100 operations, a 120-second timeout, and a 12,000-character output cap. Concurrent filters share the Jev request budget.
- A block is at most 60 lines or 6,000 UTF-16 code units. Chunking is not AST-based. A file is at most 1 MB. A session stores at most 5 MB of file snapshots. One filter accepts at most 256 blocks. A request carries at most 24 questions or 24 KB of UTF-8 JSON. That is not a precise token limit.
- A changed source rejects old references. New refs must be obtained. Dependency expansion, answer caching, cross-session state, automatic context compaction, and a task scorer are not implemented.
- The child process can stop a stuck execution. It is not a security sandbox for hostile code. Node `vm` is not a security boundary either. Host permissions remain. This is for trusted local research. Real provider keys are not injected into the child, but that does not make it hostile-code isolation.
- Await every repo and Jev call. A cell that leaves calls running closes the session. Do not start background work inside a cell.

## What has been checked

TypeScript builds, the offline tests, the mock loop, and model-config parsing pass. The first live investigation on 2026-09-25 used block-level `filter` only. The root model found the cache/revocation bug and then read all three files. See [smoke test](SMOKE_TEST.md). Later direct `locate` and `ask` calls showed that Jev can point at a line and answer several claims in one request. Those calls were not made by the root loop.

A later booking probe, recorded in [eval/booking-2026-09-25.md](eval/booking-2026-09-25.md), asked both modes to explain a cross-file expiry bug. Both answers were complete. Jev mode made zero Jev calls and printed the whole corpus. That was expected once the corpus was small enough to print. It does not measure the intended gain.

The intended comparison is root input tokens, estimated root cost, printed source characters, and whether required evidence is still cited. It needs a corpus large enough that printing everything is the expensive path. Answer quality is checked so a cheaper trace does not quietly drop the mechanism. One run per mode is not that comparison.

Interfaces: [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart), [Noul and structured instructions](https://docs.typesafe.ai/primitives/noul). Design reference: [RLM minimal](https://github.com/alexzhang13/rlm-minimal).
