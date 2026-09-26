# SOCO

System One context offloading. A root model investigates a repository by writing code. Source stays in that code environment. Jev judges the pieces the code sends it and returns probabilities, not an explanation. Only what the code prints comes back into the root model's context.

The point is to keep source out of the root window. That leaves fewer root tokens, a lower cost, and room for the rest of the investigation. It is not a claim that the answer will be more accurate than reading the source directly. A strong root model can solve the same question by reading. Jev is the cheaper judgment step, closer to speculative decoding than to a stronger model.

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

`state` persists across cells. Bindings declared with `let` or `const` do not. `print` is the only channel back to the root model.

## What the code can call

| Call | What it does |
|---|---|
| `repo.files`, `repo.symbols`, `repo.blocks`, `repo.search` | List, index, and search without returning whole files |
| `repo.window`, `repo.lines`, `repo.read` | Load original text when a span is actually needed |
| `jev.ask(material, questions)` | Ask up to 16 independent questions about one material |
| `jev.locate`, `jev.filter` | Point at a line, or drop a whole block |

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

`--mode read` runs the same loop without Jev. `demo` is an offline scripted loop. It checks the plumbing and is not a model result.

A live call sends candidate text to TypeSafe. The child process limits stuck execution. It is not a sandbox for hostile code.

Design reference: [RLM minimal](https://github.com/alexzhang13/rlm-minimal). Jev: [TypeSafe](https://docs.typesafe.ai/introduction/quickstart).
