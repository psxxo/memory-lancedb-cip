import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import jitiFactory from "jiti";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

describe("no hardcoded model defaults (owner directive 2026-10-03)", () => {
  it("entry files name no fallback default embedding model id", () => {
    for (const f of ["index.ts", "cli.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      assert.ok(!src.includes("text-embedding-3-small"), f + " must not name a default embedding model id");
    }
  });

  it("the generation model resolves to no model when unconfigured", () => {
    const jiti = jitiFactory(import.meta.url, { interopDefault: true });
    const { resolveGenerationModel } = jiti("../src/load-safety.ts");
    const r = resolveGenerationModel({});
    assert.equal(r.explicit, false);
    assert.equal(r.modelRef, undefined);
  });

  it("a direct lane with the plugin's own endpoint is not gated on the host catalog", () => {
    const jiti = jitiFactory(import.meta.url, { interopDefault: true });
    const { evaluateGenerationModelAvailability } = jiti("../src/load-safety.ts");
    const inventory = { refs: new Set(), providers: new Set(), sources: [], confirmed: false };
    const r = evaluateGenerationModelAvailability({
      inventory,
      model: { modelRef: "any-model-id", modelId: "any-model-id", explicit: true },
      pluginResolvesModel: true,
    });
    assert.equal(r.status, "available");
  });
});
