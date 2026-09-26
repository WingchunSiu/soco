import vm from "node:vm";
import { inspect } from "node:util";

// A disposable process for time limits, NOT a security sandbox for hostile code.
let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const rpc = (method: string, ...args: unknown[]) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  process.send?.({ type: "rpc", id, method, args });
});
let output = "", truncated = false;
const budgetArg = process.argv.indexOf("--print-budget");
const printBudget = budgetArg >= 0 ? Number(process.argv[budgetArg + 1]) : 12000;
const clip = (value: string) => value.length > 1600 ? value.slice(0, 1600) + "…[truncated]" : value;
const print = (...args: unknown[]) => {
  if (output.length >= printBudget) {
    if (!output.includes("print budget exhausted")) output += "print budget exhausted; print one cited line, not an index\n";
    truncated = true;
    return;
  }
  const line = args.map(v => clip(typeof v === "string" ? v : inspect(v, { depth: 5, maxArrayLength: 20, maxStringLength: 500, customInspect: false, getters: false }))).join(" ") + "\n";
  const room = 12000 - output.length;
  output += line.slice(0, Math.max(0, room));
  if (line.length > room || args.some(v => (typeof v === "string" ? v : inspect(v)).length > 500)) truncated = true;
};
const context = vm.createContext({
  state: {}, print, console: { log: print },
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
  output = ""; truncated = false;
  let error: string | undefined;
  try {
    const script = new vm.Script(`(async () => {\n${message.code}\n})()`);
    await script.runInContext(context, { timeout: 2000 });
    // Unawaited RPCs would mutate state or spend budget after a cell appears done.
    if (pending.size) throw new Error("Unawaited tool calls: await every repo/jev operation");
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  process.send?.({ type: "result", output, truncated, error });
});
process.send?.({ type: "ready" });
