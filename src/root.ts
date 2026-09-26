import { complete, getModels, getProviders, type Api, type Model, type AssistantMessage, type KnownProvider, type Message } from "@mariozechner/pi-ai";
import type { RootModel, Turn } from "./harness.js";

// The pinned SDK predates this model. Keep the verified model definition here
// rather than silently substituting an older Grok model.
// https://docs.x.ai/developers/models/grok-4.7 (checked 2026-09-25)
const grok47: Model<"openai-completions"> = {
  id: "grok-4.7", name: "Grok 4.7", provider: "xai",
  api: "openai-completions", baseUrl: "https://api.x.ai/v1",
  reasoning: true, input: ["text", "image"], contextWindow: 500000,
  maxTokens: 4096, // Local harness output cap, not the provider's maximum.
  cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  compat: { supportsReasoningEffort: true },
};

export function listModels(provider: string): string[] {
  if (!getProviders().includes(provider as KnownProvider)) throw new Error("Unknown ROOT_PROVIDER; use a provider supported by pi-ai");
  return [...new Set([...getModels(provider as KnownProvider).map(m => m.id), ...(provider === "xai" ? [grok47.id] : [])])];
}
export function resolveRootModel(provider: string, modelId: string): Model<Api> {
  listModels(provider);
  const model = getModels(provider as KnownProvider).find(m => m.id === modelId)
    ?? (provider === "xai" && modelId === grok47.id ? grok47 : undefined);
  if (!model) throw new Error("ROOT_MODEL is not in the supported model catalog; run the models command");
  return model;
}
export function rootFailure(diagnostic: unknown): Error {
  const message = diagnostic instanceof Error ? diagnostic.message : typeof diagnostic === "string" ? diagnostic : "";
  if (/incorrect api key|invalid api key|authentication|unauthorized|\b401\b/i.test(message))
    return new Error("Root provider rejected authentication; check ROOT_API_KEY for the selected provider");
  return new Error("Root model request failed; verify provider, model, key, and connectivity");
}
export function piRoot(provider: string, modelId: string, key: string | undefined): RootModel {
  const model = resolveRootModel(provider, modelId);
  if (!key) throw new Error("Set ROOT_API_KEY for autonomous runs; Jev-only commands do not need it");
  const replies = new Map<number, AssistantMessage>();
  return {
    async complete(system: string, turns: Turn[]) {
      const messages: Message[] = turns.map((turn, i) => {
        if (turn.role === "user") return { role: "user", content: turn.content, timestamp: Date.now() };
        const previous = replies.get(i);
        if (!previous) throw new Error("Root conversation history is inconsistent");
        return previous;
      });
      let reply: AssistantMessage;
      try {
        reply = await complete(model, { systemPrompt: system, messages }, {
          apiKey: key, maxTokens: 4096, signal: AbortSignal.timeout(120000),
        });
      } catch (error) { throw rootFailure(error); }
      if (reply.stopReason === "error") throw rootFailure(reply.errorMessage);
      if (reply.stopReason === "aborted") throw new Error("Root model request was aborted or timed out");
      replies.set(turns.length, reply);
      return {
        text: reply.content.filter(c => c.type === "text").map(c => c.text).join("\n"),
        usage: { ...reply.usage, provider, model: model.id, responseModel: reply.responseModel, stopReason: reply.stopReason },
      };
    },
  };
}
