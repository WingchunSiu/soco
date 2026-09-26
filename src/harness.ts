import type { Runtime } from "./runtime.js";
import { systemPrompt } from "./prompt.js";
import { integer, text, type Trace } from "./types.js";

export interface Turn { role: "user" | "assistant"; content: string }
export interface RootReply { text: string; usage?: unknown }
export interface RootModel { complete(system: string, messages: Turn[]): Promise<RootReply> }
export function parseAction(value: string): { action: "code"; code: string } | { action: "final"; answer: string } {
  const parsed = JSON.parse(value);
  if (parsed?.action === "code") return { action: "code", code: text(parsed.code, "code", 16000) };
  if (parsed?.action === "final") return { action: "final", answer: text(parsed.answer, "answer", 24000) };
  throw new Error("Expected a code or final action");
}
export async function runHarness(options: {
  task: string; runtime: Runtime; root: RootModel; mode: "jev" | "read"; maxSteps?: number; trace?: Trace;
}) {
  const { task, runtime, root, mode, trace = () => {} } = options;
  text(task, "task", 8000);
  const maxSteps = integer(options.maxSteps ?? 12, "maxSteps", 1, 100);
  const messages: Turn[] = [{ role: "user", content: task }];
  const system = systemPrompt(mode);
  const usages: unknown[] = [];
  const started = performance.now();
  trace({ type: "run_start", mode, task, maxSteps, systemPrompt: system });
  for (let step = 1; step <= maxSteps; step++) {
    const reply = await root.complete(system, messages);
    usages.push(reply.usage ?? null);
    trace({ type: "root_reply", step, ...reply });
    messages.push({ role: "assistant", content: reply.text });
    let action;
    try { action = parseAction(reply.text); }
    catch {
      messages.push({ role: "user", content: 'Invalid action. Return exactly {"action":"code","code":"..."} or {"action":"final","answer":"..."} as JSON.' });
      continue;
    }
    if (action.action === "final") {
      const result = { status: "completed" as const, answer: action.answer, steps: step, rootUsage: usages, milliseconds: performance.now() - started };
      trace({ type: "run_end", ...result });
      return result;
    }
    const observation = await runtime.eval(action.code);
    messages.push({ role: "user", content: JSON.stringify({ observation, remainingSteps: maxSteps - step }) });
  }
  const result = { status: "budget_exhausted" as const, answer: null, steps: maxSteps, rootUsage: usages, milliseconds: performance.now() - started };
  trace({ type: "run_end", ...result });
  return result;
}
