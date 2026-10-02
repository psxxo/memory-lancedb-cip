import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { evaluateGenerationModelAvailability } = jiti("../src/load-safety.ts");

const inventory = { refs: new Set(["deepseek-flash"]), providers: new Set(["deepseek"]), sources: ["models.providers"], confirmed: true };

describe("generation model availability gate", () => {
  it("passes when the host resolves the default (host transport, no model)", () => {
    const r = evaluateGenerationModelAvailability({ inventory, model: { explicit: false }, hostResolvesModel: true });
    assert.equal(r.status, "available");
  });
  it("fails closed when an explicit model is absent from the host catalog", () => {
    const r = evaluateGenerationModelAvailability({ inventory, model: { modelRef: "qwen-flash", modelId: "qwen-flash", explicit: true } });
    assert.equal(r.status, "unavailable");
  });
  it("passes when the plugin's own endpoint resolves the model (direct lane)", () => {
    const r = evaluateGenerationModelAvailability({ inventory, model: { modelRef: "qwen-flash", modelId: "qwen-flash", explicit: true }, pluginResolvesModel: true });
    assert.equal(r.status, "available");
  });
});
