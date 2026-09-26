import test from "node:test";
import assert from "node:assert/strict";
import { listModels, resolveRootModel, rootFailure } from "../src/root.js";

test("Grok 4.7 resolves to the actual requested xAI model despite older SDK catalog", () => {
  assert.ok(listModels("xai").includes("grok-4.7"));
  const model = resolveRootModel("xai", "grok-4.7");
  assert.equal(model.id, "grok-4.7");
  assert.equal(model.provider, "xai");
  assert.equal(model.baseUrl, "https://api.x.ai/v1");
  assert.throws(() => resolveRootModel("anthropic", "grok-4.7"), /catalog/);
});

test("provider errors identify auth rejection without echoing sensitive diagnostics", () => {
  const secret = "TEST_ONLY_PRIVATE_VALUE";
  const error = rootFailure(new Error(`Incorrect API key provided: ${secret}`));
  assert.match(error.message, /authentication/);
  assert.ok(!error.message.includes(secret));
  assert.ok(!rootFailure(`Some server body: ${secret}`).message.includes(secret));
});
