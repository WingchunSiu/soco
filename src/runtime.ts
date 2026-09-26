import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Corpus } from "./corpus.js";
import type { Jev } from "./jev.js";
import { integer, text, type Ref, type Span, type Trace } from "./types.js";

export interface CellResult { output: string; truncated: boolean; error?: string }
export class Runtime {
  private child: ChildProcess;
  private ready: Promise<void>;
  private active?: { resolve: (result: CellResult) => void; timer: NodeJS.Timeout };
  private closed = false;
  private controller = new AbortController();
  private rpcCount = 0;
  private jevCalls = 0;
  get calls() { return this.jevCalls; }
  readonly metrics = { cells: 0, observationChars: 0 };
  constructor(private corpus: Corpus, private jev?: Jev, private timeout = 120000, private trace: Trace = () => {}) {
    integer(timeout, "cell timeout", 1, 600000);
    this.child = fork(fileURLToPath(new URL("./cell-worker.js", import.meta.url)), jev ? ["--print-budget", "2500"] : ["--read-only"], {
      execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
      // Keys stay in the host process, never in the generated-code environment.
      env: { PATH: process.env.PATH ?? "" },
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error("Code worker startup timed out")); }, 10000);
      this.child.once("error", () => { clearTimeout(timer); reject(new Error("Code worker failed to start")); });
      this.child.once("exit", () => { clearTimeout(timer); reject(new Error("Code worker exited")); });
      this.child.on("message", (message: any) => {
        if (message.type === "ready") { clearTimeout(timer); resolve(); }
        if (message.type === "rpc") void this.handleRpc(message);
        if (message.type === "result" && this.active) {
          clearTimeout(this.active.timer);
          const result: CellResult = { output: message.output, truncated: message.truncated, ...(message.error ? { error: message.error } : {}) };
          this.metrics.observationChars += result.output.length;
          this.trace({ type: "cell_result", ...result });
          this.active.resolve(result);
          this.active = undefined;
          if (result.error?.startsWith("Unawaited tool calls")) this.close();
        }
      });
      this.child.on("exit", () => {
        this.closed = true;
        this.controller.abort();
        if (this.active) {
          clearTimeout(this.active.timer);
          this.active.resolve({ output: "", truncated: false, error: "Code worker exited; session is closed" });
          this.active = undefined;
        }
      });
    });
  }
  private async handleRpc(message: any): Promise<void> {
    let value: unknown, error: string | undefined;
    try {
      if (!this.active || ++this.rpcCount > 100) throw new Error("Tool call limit reached in this cell (100)");
      const args: any[] = message.args;
      switch (message.method) {
        case "repo.files": value = await this.corpus.files(args[0]); break;
        case "repo.blocks": value = await this.corpus.blocks(args[0]); break;
        case "repo.symbols": value = await this.corpus.symbols(args[0]); break;
        case "repo.read": value = await this.corpus.read(text(args[0]?.id, "block id"), args[1]); break;
        case "repo.lines": value = await this.corpus.lines(args[0] as Span[], args[1]); break;
        case "repo.window": value = await this.corpus.window(args[0], args[1], args[2]); break;
        case "repo.search": value = await this.corpus.search(args[0], args[1]); break;
        case "jev.ask":
          if (!this.jev) throw new Error("Jev is disabled in the read baseline");
          value = await this.jev.ask(args[0], args[1], this.controller.signal);
          this.jevCalls++;
          break;
        case "jev.filter":
          if (!this.jev) throw new Error("Jev is disabled in the read baseline");
          value = await this.jev.filter(args[0] as Ref[], args[1], args[2], this.controller.signal);
          this.jevCalls++;
          break;
        case "jev.locate":
          if (!this.jev) throw new Error("Jev is disabled in the read baseline");
          value = await this.jev.locate(args[0], args[1], this.controller.signal);
          this.jevCalls++;
          break;
        default: throw new Error("Unknown operation");
      }
      this.trace({ type: "operation", method: message.method, args, resultChars: JSON.stringify(value).length });
    } catch (cause) { error = cause instanceof Error ? cause.message : "Operation failed"; }
    if (this.child.connected) this.child.send({ type: "rpc_result", id: message.id, value, error });
  }
  async eval(code: string): Promise<CellResult> {
    text(code, "code", 16000);
    await this.ready;
    if (this.closed) throw new Error("Session is closed; create a new runtime");
    if (this.active) throw new Error("Wait for the previous cell before executing another");
    this.rpcCount = 0;
    this.metrics.cells++;
    this.trace({ type: "cell", code });
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        const result = { output: "", truncated: false, error: "Cell timed out; session terminated and state discarded" };
        this.trace({ type: "cell_result", ...result });
        this.active = undefined;
        this.close();
        resolve(result);
      }, this.timeout);
      this.active = { resolve, timer };
      this.child.send({ type: "eval", code });
    });
  }
  close(): void {
    this.closed = true;
    this.controller.abort();
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.resolve({ output: "", truncated: false, error: "Session closed" });
      this.active = undefined;
    }
    this.child.kill("SIGKILL");
  }
}
