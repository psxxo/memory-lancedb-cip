import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const mod = jiti("../index.ts");
const collectStoreSecretRefs = mod.collectStoreSecretRefs;
const cache = mod.__getStoreSecretCacheForTests;
const resolveRef = mod.__resolveSecretRefForTests;
const api = { resolvePath: (p) => p };

describe("SecretRef sources", () => {
  it("collects store refs anywhere in the config tree", () => {
    const storeRef = { source: "store", id: "MY_KEY" };
    const deepRef = { source: "store", provider: "team", id: " DEEPSEEK_KEY " };
    const fileRef = { source: "file", id: "/tmp/k" };
    const cfg = {
      llm: { apiKey: storeRef, model: "x" },
      embedding: { apiKey: [fileRef] },
      deep: { nested: [deepRef] },
    };
    const refs = collectStoreSecretRefs(cfg);
    assert.equal(refs.length, 2);
    assert.deepEqual(refs.map((r) => r.id).sort(), ["DEEPSEEK_KEY", "MY_KEY"]);
  });

  it("fails closed for a store ref that is not primed yet", () => {
    assert.throws(
      () => resolveRef(api, { source: "store", id: "NOPE" }, "llm.apiKey"),
      /not resolved yet/,
    );
  });

  it("returns a primed store value and keys by provider", () => {
    cache().set("default:MY_KEY", "store-value");
    assert.equal(resolveRef(api, { source: "store", id: "MY_KEY" }, "llm.apiKey"), "store-value");
    cache().clear();
  });

  it("still resolves file refs", () => {
    const dir = mkdtempSync(join(tmpdir(), "mlc-secretref-"));
    const file = join(dir, "k");
    writeFileSync(file, "file-value\n", "utf8");
    try {
      assert.equal(resolveRef(api, { source: "file", id: file }, "x"), "file-value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
