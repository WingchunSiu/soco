import repl from "node:repl";
import { PassThrough } from "node:stream";
import { OutputBudget, render } from "./output.js";

// A disposable process for time limits, NOT a security sandbox for hostile code.
let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const rpc = (method: string, ...args: unknown[]) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  process.send?.({ type: "rpc", id, method, args });
});
const arg = (name: string, fallback: number) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : Number(process.argv[i + 1]); };
const output = new OutputBudget(arg("--output-budget", 16000), arg("--cell-budget", 6000));
const print = (...args: unknown[]) => {
  output.emit(args.map(render).join(" ") + "\n");
};
const server = repl.start({prompt:"",input:new PassThrough(),output:new PassThrough(),terminal:false,ignoreUndefined:true});
// Node's REPL reports some evaluation errors via its domain rather than the
// eval callback. Forward both paths so a bad cell does not hang the session.
let rejectEvaluation: ((error: Error) => void) | undefined;
(server as unknown as { _domain: { on: (name: string, callback: (error: Error) => void) => void } })._domain.on("error", error => rejectEvaluation?.(error));
server.on("error", error => rejectEvaluation?.(error));
const context = server.context;
Object.assign(context, {
  state: {}, print, budget: () => output.status(), console: { log: print },
  repo: {
    files: (path = ".") => rpc("repo.files", path),
    blocks: (path = ".") => rpc("repo.blocks", path),
    symbols: (path = ".") => rpc("repo.symbols", path),
    read: (ref: { id: string }, padding = 0) => rpc("repo.read", ref, padding),
    lines: (spans: unknown[], padding = 0) => rpc("repo.lines", spans, padding),
    window: (path: string, start: number, end: number) => rpc("repo.window", path, start, end),
    search: (term: string, path = ".") => rpc("repo.search", term, path),
  },
  ...(process.argv.includes("--read-only") ? {} : {
    jev: {
      map: (records: Record<string, unknown>, questions: Record<string, unknown>, context?: unknown) => rpc("jev.map", records, questions, context),
      ask: (material: unknown, questions: Record<string, unknown>) => rpc("jev.ask", material, questions),
      filter: (refs: unknown[], question: string, threshold = 0.35) => rpc("jev.filter", refs, question, threshold),
      locate: (question: string, views: unknown[]) => rpc("jev.locate", question, views),
    },
  }),
});

process.on("message", async (message: any) => {
  if (message.type === "rpc_result") {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error));
    else request?.resolve(message.value);
    return;
  }
  if (message.type !== "eval") return;
  output.resetCell();
  let error: string | undefined;
  let fatal = false;
  try {
    await new Promise<void>((resolve, reject) => {
      rejectEvaluation = reject;
      server.eval(message.code + "\n", context, "soco-cell", (error: Error | null) => error ? reject(error) : resolve());
    });
    // Unawaited RPCs would mutate state or spend budget after a cell appears done.
    if (pending.size) { fatal = true; throw new Error("Unawaited tool calls: await every repo/jev operation"); }
  } catch (cause) { error = output.diagnostic(cause instanceof Error ? cause.message : String(cause)); }
  rejectEvaluation = undefined;
  process.send?.({ type: "result", output: output.output, truncated: output.rejectedChars > 0, budget: output.status(), error, fatal });
});
process.send?.({ type: "ready" });
