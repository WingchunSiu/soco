import { config } from "dotenv";
import { appendFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { Corpus } from "./corpus.js";
import { Jev, httpTransport } from "./jev.js";
import { Runtime } from "./runtime.js";
import { runHarness } from "./harness.js";
import { mockJev, scriptedRoot } from "./mock.js";
import { integer, text, type Trace } from "./types.js";

export const PROJECT = fileURLToPath(new URL("../../", import.meta.url));
config({ path: resolve(PROJECT, ".env"), quiet: true });
const out = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const numeric = (value: string | undefined, fallback: number, name: string, min: number, max: number) => integer(value === undefined ? fallback : Number(value), name, min, max);

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    root: { type: "string" }, path: { type: "string", default: "." }, query: { type: "string" }, task: { type: "string" },
    mode: { type: "string", default: "jev" }, mock: { type: "boolean", default: false },
    "max-steps": { type: "string" }, "max-jev-requests": { type: "string" }, provider: { type: "string" }, help: { type: "boolean" },
  } });
  const command = positionals[0];
  if (!command || values.help || command === "help") {
    console.log(`soco (Node 22+)\n\nCommands:\n  demo                                  Scripted, offline, no keys\n  select --root DIR --path FILE_OR_DIR --query QUESTION [--mock]\n  session --root DIR [--mode jev|read] [--mock]\n    Persistent JSONL code session: stdin {"code":"..."}, stdout one result per line\n  run --root DIR --task QUESTION [--mode jev|read] [--max-steps 12]\n  models [--provider anthropic]\n\nProject .env: ${resolve(PROJECT, ".env")}\nLive select/session send candidate text to TypeSafe. run also needs ROOT_API_KEY and ROOT_MODEL.\nSessions execute model-generated JS in a child process; this is NOT a hostile-code sandbox.`);
    return;
  }
  if (command === "models") {
    const { listModels } = await import("./root.js");
    out(listModels(values.provider ?? process.env.ROOT_PROVIDER ?? "xai"));
    return;
  }
  if (!["demo", "select", "session", "run"].includes(command)) throw new Error("Unknown command; use help");
  if (values.mode !== "jev" && values.mode !== "read") throw new Error("mode must be jev or read");
  if (command === "run" && values.mock) throw new Error("Use demo for scripted mocks; run always uses a real root model");
  const mode = values.mode;
  const maxRequests = numeric(values["max-jev-requests"] ?? process.env.MAX_JEV_REQUESTS, 20, "maxJevRequests", 1, 1000);
  const maxSteps = numeric(values["max-steps"] ?? process.env.MAX_STEPS, 12, "maxSteps", 1, 100);
  const timeout = numeric(process.env.CELL_TIMEOUT_MS, 120000, "cellTimeout", 1, 600000);
  const offline = command === "demo" || values.mock;
  const corpus = await Corpus.open(command === "demo" ? resolve(PROJECT, "examples/repo") : text(values.root, "--root"));
  const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
  const tracePath = resolve(PROJECT, "runs", `${runId}.jsonl`);
  mkdirSync(resolve(PROJECT, "runs"), { recursive: true, mode: 0o700 });
  closeSync(openSync(tracePath, "wx", 0o600));
  const trace: Trace = event => appendFileSync(tracePath, JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n");
  trace({ type: "config", command, root: corpus.root, mode, mock: offline, maxRequests, maxSteps });
  const jev = new Jev(corpus, offline ? mockJev : httpTransport(process.env.TYPESAFE_API_KEY), process.env.JEV_MODEL ?? "jev-latest", maxRequests, trace);
  if (command === "select") {
    const refs = await corpus.blocks(values.path);
    const selection = await jev.filter(refs, text(values.query, "--query"));
    out({ ...selection, mock: offline, metrics: jev.metrics, tracePath });
    return;
  }
  // Validate root configuration before starting the worker.
  const root = command === "demo" ? scriptedRoot() : command === "run" ? (await import("./root.js")).piRoot(
    process.env.ROOT_PROVIDER ?? "xai", text(process.env.ROOT_MODEL, "ROOT_MODEL"), process.env.ROOT_API_KEY,
  ) : undefined;
  const runtime = new Runtime(corpus, mode === "jev" ? jev : undefined, timeout, trace);
  const cleanup = () => { runtime.close(); process.exitCode = 130; };
  process.once("SIGINT", cleanup);
  try {
    if (command === "session") {
      process.stderr.write(`Session ready (${mode}${offline ? ", MOCK" : ""}); trace: ${tracePath}\n`);
      for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
        try {
          const input = JSON.parse(line);
          out(await runtime.eval(text(input.code, "code", 16000)));
        } catch (error) { out({ error: error instanceof Error ? error.message : "Invalid request" }); }
      }
    } else {
      const task = command === "demo" ? "Why can a session remain valid after logout?" : text(values.task, "--task", 8000);
      const result = await runHarness({ task, runtime, root: root!, mode, maxSteps, trace });
      out({ ...result, mock: offline, metrics: { corpus: corpus.metrics, jev: jev.metrics, runtime: runtime.metrics }, tracePath });
      if (result.status !== "completed") process.exitCode = 2;
    }
  } catch (error) {
    trace({ type: "run_error", error: error instanceof Error ? error.message : "Unknown error" });
    throw error;
  } finally { runtime.close(); process.removeListener("SIGINT", cleanup); }
}
main().catch(error => { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : "Command failed" }) + "\n"); process.exitCode = 1; });
