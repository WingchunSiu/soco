# First live smoke test — 2026-09-25

Scope: authenticate and exercise a single real Jev selection over the three-file synthetic fixture. This is not an evaluation of task accuracy, speedup, or savings.

Query: `Which code could explain a session remaining valid after logout?`

| Source | Returned Noul probability | Selection at threshold 0.35 |
|---|---:|---|
| `auth.ts` | 0.90 | retained |
| `cache.ts` | 0.80 | retained |
| `display.ts` | 0.02 | excluded |

One real request, 1097 input tokens, 119 output tokens; measured transport time approximately 247 ms. No unknown judgments. This agrees with the intended relevance of this hand-built example. It says nothing about general retrieval recall or final agent task success.

Local trace: `runs/2026-09-25T21-35-28.346Z-a2d31a18.jsonl` (ignored by Git).

The initial xAI `/v1/models` check returned HTTP 400 with `Incorrect API key provided`. After the user corrected the key, the check returned HTTP 200 and listed `grok-4.7`.

Validation after adapting the model catalog: TypeScript build and 13 offline tests passed. No different model was substituted.

## Grok + Jev integration retry

The real `xai / grok-4.7` loop completed in 5 root calls and approximately 11.12 seconds, within a ceiling of 6 root calls and 2 Jev requests. It executed four code cells:

1. List the three fixture files.
2. Obtain their block references.
3. Ask Jev about logout/session revocation relevance, using a model-chosen threshold of 0.2.
4. Read both selected blocks, and additionally read the excluded display block.

Jev returned `auth.ts=0.91`, `cache.ts=0.80`, `display.ts=0.02`; one request took approximately 252 ms and reported 1119 input / 119 output tokens. The resolved Jev model was `jev-1.13.0`.

Grok correctly identified the core bug: the allow cache is consulted before the revocation set, while logout adds to the revocation set without invalidating the allow cache. It suggested clearing the cache entry and checking revocation first. Its statement that the session remains valid "until the process restarts" is not established by this fixture: the in-memory revocation set also resets, and arbitrary unseen IDs are accepted. The diagnosis is useful, but the final answer is not wholly validated.

The SDK's estimated root-model cost sums to **$0.015506**, excluding Jev. This is an estimate from returned token usage and configured prices, not an invoice. Total source returned to the code environment was 567 characters; code observations shown to the root totaled 3305 characters including metadata.

The task explicitly requested using `jev.filter` to exercise the integration. This does **not** test whether the agent chooses Jev spontaneously. It also demonstrates **no source-reading reduction** on this run: the root eventually read all three files. There was no read-baseline run and no comparative claim is supported by this small fixture.

Local trace: `runs/2026-09-25T21-56-00.119Z-bab3802d.jsonl` (ignored by Git).

## Direct `locate` probes, same day

These two calls did not go through the root-model loop. They check whether the new line-level action can point at the fixture, not whether Grok will use it.

Declaration lines, one view, one request, about 419 ms, 586 input / 81 output tokens. `present` was 0.87. Returned probabilities: `logout` 0.40, `isAllowed` 0.29, `allowCache` 0.20, `revoked` 0.11, `greeting` 0. No unknown scores. Because these lines shared one view, the numbers compete with each other; they are not independent file-relevance scores.

Numbered lines of `auth.ts`, one request, about 180 ms, 765 input / 153 output tokens. `present` was 0.97. The line `if (allowCache.has(sessionId)) return true;` received 0.97. `revoked.add(sessionId)` received 0.02. The other eleven lines were at or near 0.

This is a useful routing result on a hand-built 13-line file. It does not measure reading reduction, answer quality, or behavior on a larger repository. No trace file was written for these two probes; the numbers above are from the command output.

## Direct `ask` probe, same day

One request over the numbered `auth.ts` window, three independent questions, about 259 ms, 1016 input / 155 output tokens. No unknown answers.

| Question | Returned |
|---|---|
| Does a cache check return success before revocation can run? | noul 0.94 |
| Does logout remove or overwrite the allow cache entry? | noul 0.06 |
| Which line is the best place to start? | `w4`, probability 0.75 |

`w4` is `if (allowCache.has(sessionId)) return true;`. The two noul values are independent; they do not form a proof, and this call was not made by the root model. It checks that one `ask` can return a claim judgment and a line choice together. It does not show that the root model will write those questions, or that this reduces reading on a larger repository.
