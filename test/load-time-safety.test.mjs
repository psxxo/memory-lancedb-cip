/**
 * Load-time safety (v1.2.6)
 *
 * The plugin must be IMPOSSIBLE to wedge the host at load time. This suite pins
 * the five guarantees that ship with 1.2.6:
 *
 *   1. register()/load issues ZERO outbound network requests (no embedding
 *      warmup, no LLM probe) and returns synchronously.
 *   2. The effective generation LLM is validated against the HOST model
 *      inventory before any client is built; when it cannot be confirmed
 *      available, smartExtraction is disabled with a loud, actionable log and
 *      the LLM is never called.
 *   3. smartExtraction defaults to OFF (opt-in) — a behavior change.
 *   4. Load/init is bounded and observable (phase log + load-time network
 *      conclusion + a threshold warning).
 *   5. `memory-cip doctor` reports the embedding model/provider, the generation
 *      model and its availability, the effective smartExtraction state, and the
 *      zero-network-at-load conclusion.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import jitiFactory from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const pluginSdkStubPath = path.resolve(testDir, "helpers", "openclaw-plugin-sdk-stub");
const jiti = jitiFactory(import.meta.url, {
  interopDefault: true,
  alias: { "openclaw/plugin-sdk": pluginSdkStubPath },
});

const pluginModule = jiti("../index.ts");
const plugin = pluginModule.default || pluginModule;
const { resetRegistration, _getLoadSafetyReportForTest } = pluginModule;
const loadSafety = jiti("../src/load-safety.ts");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createApi({ pluginConfig, hostConfig, root }) {
  const logs = { debug: [], info: [], warn: [], error: [] };
  const api = {
    id: "memory-lancedb-cip",
    name: "Memory LanceDB CIP",
    version: "1.2.6",
    source: "test",
    registrationMode: "runtime",
    pluginConfig,
    config: hostConfig,
    resolvePath(target) {
      if (typeof target !== "string") return target;
      if (path.isAbsolute(target)) return target;
      return path.join(root, target);
    },
    logger: {
      debug: (m) => logs.debug.push(String(m)),
      info: (m) => logs.info.push(String(m)),
      warn: (m) => logs.warn.push(String(m)),
      error: (m) => logs.error.push(String(m)),
    },
    registerTool() {},
    registerCli() {},
    registerService() {},
    registerHook() {},
    registerMemoryCapability() {},
    on() {},
  };
  return { api, logs };
}

function installNetworkSpies() {
  const calls = { fetch: 0, http: 0, https: 0 };
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;

  globalThis.fetch = (...args) => {
    calls.fetch++;
    return Promise.reject(new Error("network disabled in test"));
  };
  http.request = (...args) => {
    calls.http++;
    throw new Error("network disabled in test");
  };
  http.get = (...args) => {
    calls.http++;
    throw new Error("network disabled in test");
  };
  https.request = (...args) => {
    calls.https++;
    throw new Error("network disabled in test");
  };
  https.get = (...args) => {
    calls.https++;
    throw new Error("network disabled in test");
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
      http.request = originalHttpRequest;
      http.get = originalHttpGet;
      https.request = originalHttpsRequest;
      https.get = originalHttpsGet;
    },
  };
}

function withTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "memory-lancedb-cip-loadsafety-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const BASE_PLUGIN_CONFIG = (root) => ({
  dbPath: path.join(root, "db"),
  embedding: { provider: "openai-compatible", apiKey: "sk-test", model: "text-embedding-3-small" },
});

function hostConfigWithModels(models) {
  return {
    models: {
      providers: {
        openai: { baseUrl: "https://api.openai.com/v1", models: models.map((id) => ({ id })) },
      },
    },
  };
}

beforeEach(() => {
  // The Gateway path (not CLI mode) is what we are pinning here: OPENCLAW_CLI
  // downgrades the load logs to debug, so clear it for the duration.
  if (process.env.OPENCLAW_CLI !== undefined) {
    savedCliEnv = process.env.OPENCLAW_CLI;
    delete process.env.OPENCLAW_CLI;
  }
  resetRegistration();
});
afterEach(() => {
  if (savedCliEnv !== undefined) process.env.OPENCLAW_CLI = savedCliEnv;
  savedCliEnv = undefined;
  resetRegistration();
});

let savedCliEnv;

// ---------------------------------------------------------------------------
// 1) Zero network at load
// ---------------------------------------------------------------------------

describe("load-time zero network", () => {
  it("register() makes no outbound request and returns synchronously", () => {
    withTempRoot((root) => {
      const spies = installNetworkSpies();
      try {
        const { api, logs } = createApi({
          pluginConfig: BASE_PLUGIN_CONFIG(root),
          hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
          root,
        });

        const returned = plugin.register(api);
        // register() must be synchronous: an async register would return a
        // promise whose rejection can escape the host's load loop.
        assert.equal(returned, undefined, "register() must not return a promise");
        assert.equal(spies.calls.fetch, 0, "no fetch() at load");
        assert.equal(spies.calls.http, 0, "no http.request/get at load");
        assert.equal(spies.calls.https, 0, "no https.request/get at load");

        const report = _getLoadSafetyReportForTest();
        assert.ok(report, "load-safety report must be captured");
        assert.equal(report.loadTimeNetwork, "none");
      } finally {
        spies.restore();
      }
    });
  });

  it("stays silent on the network even after the microtask queue drains", async () => {
    await withTempRootAsync(async (root) => {
      const spies = installNetworkSpies();
      try {
        const { api } = createApi({
          pluginConfig: { ...BASE_PLUGIN_CONFIG(root), smartExtraction: true },
          hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
          root,
        });
        plugin.register(api);
        // A fire-and-forget warmup would surface here.
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(spies.calls.fetch, 0, "no deferred fetch() after load");
        assert.equal(spies.calls.http + spies.calls.https, 0, "no deferred request after load");
      } finally {
        spies.restore();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 2) Generation-model availability gate + safe downgrade
// ---------------------------------------------------------------------------

describe("generation-model availability gate", () => {
  it("activates smartExtraction when the model is confirmed in the host catalog", () => {
    withTempRoot((root) => {
      const { api, logs } = createApi({
        pluginConfig: {
          ...BASE_PLUGIN_CONFIG(root),
          smartExtraction: true,
          llm: { model: "openai/gpt-oss-120b" },
        },
        hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
        root,
      });
      plugin.register(api);
      const report = _getLoadSafetyReportForTest();
      assert.equal(report.generationModelStatus, "available");
      assert.equal(report.smartExtractionRequested, true);
      assert.equal(report.smartExtractionActive, true);
      assert.ok(
        [...logs.info, ...logs.debug].some((l) => l.includes("smart extraction enabled")),
        "should log that smart extraction is enabled",
      );
    });
  });

  it("disables smartExtraction when the model is absent from a confirmed catalog", () => {
    withTempRoot((root) => {
      const { api, logs } = createApi({
        pluginConfig: {
          ...BASE_PLUGIN_CONFIG(root),
          smartExtraction: true,
          llm: { model: "openai/gpt-oss-120b" },
        },
        // Host has openai, but NOT this model.
        hostConfig: hostConfigWithModels(["gpt-4o-mini"]),
        root,
      });
      plugin.register(api);
      const report = _getLoadSafetyReportForTest();
      assert.equal(report.generationModelStatus, "unavailable");
      assert.equal(report.smartExtractionActive, false);
      assert.ok(report.smartExtractionDisabledReason, "must explain why it was disabled");
      // llm.model was explicit -> loud error, never silent.
      const loud = [...logs.error, ...logs.warn].find((l) => l.includes("smartExtraction DISABLED at load"));
      assert.ok(loud, "must log a loud, explicit disable message");
      assert.match(loud, /never|No LLM call/i);
      assert.equal([...logs.info, ...logs.debug].filter((l) => l.includes("smart extraction enabled")).length, 0);
    });
  });

  it("disables smartExtraction when availability cannot be confirmed (fail closed)", () => {
    withTempRoot((root) => {
      const { api, logs } = createApi({
        pluginConfig: { ...BASE_PLUGIN_CONFIG(root), smartExtraction: true },
        // No host model catalog at all.
        hostConfig: undefined,
        root,
      });
      plugin.register(api);
      const report = _getLoadSafetyReportForTest();
      assert.equal(report.generationModelStatus, "unconfirmed");
      assert.equal(report.smartExtractionActive, false);
      assert.match(report.generationModelReason, /could not be read/);
      assert.ok(
        logs.warn.some((l) => l.includes("smartExtraction DISABLED at load")),
        "default model (not explicit) warns",
      );
    });
  });

  it("names a missing provider distinctly from a missing model", () => {
    withTempRoot((root) => {
      const { api } = createApi({
        pluginConfig: {
          ...BASE_PLUGIN_CONFIG(root),
          smartExtraction: true,
          llm: { model: "groq/llama-3.1-8b-instant" },
        },
        hostConfig: hostConfigWithModels(["gpt-4o-mini"]), // openai only
        root,
      });
      plugin.register(api);
      const report = _getLoadSafetyReportForTest();
      assert.equal(report.generationModelStatus, "unavailable");
      assert.match(report.generationModelReason, /provider "groq" is not configured/);
    });
  });
});

// ---------------------------------------------------------------------------
// 3) Safe default
// ---------------------------------------------------------------------------

describe("smartExtraction safe default", () => {
  it("defaults to OFF when the key is absent", () => {
    withTempRoot((root) => {
      const { api } = createApi({
        pluginConfig: BASE_PLUGIN_CONFIG(root),
        hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
        root,
      });
      plugin.register(api);
      const report = _getLoadSafetyReportForTest();
      assert.equal(report.smartExtractionRequested, false);
      assert.equal(report.smartExtractionActive, false);
    });
  });

  it("manifest declares smartExtraction default false", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "openclaw.plugin.json"), "utf8"));
    const schema = manifest.configSchema ?? manifest.config ?? manifest;
    const node = schema?.properties?.smartExtraction ?? schema?.smartExtraction;
    assert.ok(node, "smartExtraction must appear in the manifest config schema");
    assert.equal(node.default, false, "manifest default must be false (opt-in)");
  });
});

// ---------------------------------------------------------------------------
// 4) Bounded + observable
// ---------------------------------------------------------------------------

describe("bounded + observable load", () => {
  it("logs the load phase and asserts the no-network conclusion", () => {
    withTempRoot((root) => {
      const { api, logs } = createApi({
        pluginConfig: BASE_PLUGIN_CONFIG(root),
        hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
        root,
      });
      plugin.register(api);
      assert.ok(
        logs.debug.some((l) => l.includes("load phase complete")),
        "a load phase line must be emitted",
      );
      assert.ok(
        logs.debug.some((l) => l.includes("load-safety")),
        "the load-safety conclusion must be logged",
      );
    });
  });

  it("load completes well under the warn threshold with no pending timers", () => {
    withTempRoot((root) => {
      const { api, logs } = createApi({
        pluginConfig: BASE_PLUGIN_CONFIG(root),
        hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
        root,
      });
      const started = Date.now();
      plugin.register(api);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 2000, `load took ${elapsed}ms (must be bounded)`);
      assert.equal(
        logs.warn.filter((l) => l.includes("load phase took")).length,
        0,
        "a fast load must not warn",
      );
    });
  });

  it("warns when the load phase exceeds storage.loadWarnAfterMs", () => {
    withTempRoot((root) => {
      const { api, logs } = createApi({
        // A 0ms threshold guarantees the warning fires (the check is >=).
        pluginConfig: { ...BASE_PLUGIN_CONFIG(root), storage: { loadWarnAfterMs: 0 } },
        hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
        root,
      });
      plugin.register(api);
      assert.ok(
        logs.warn.some((l) => l.includes("load phase took")),
        "exceeding the threshold must warn",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 5) doctor
// ---------------------------------------------------------------------------

describe("memory-cip doctor load-safety section", () => {
  it("reports embedding, generation model availability and effective state", async () => {
    await withTempRootAsync(async (root) => {
      const { api } = createApi({
        pluginConfig: {
          ...BASE_PLUGIN_CONFIG(root),
          smartExtraction: true,
          llm: { model: "openai/gpt-oss-120b" },
        },
        hostConfig: hostConfigWithModels(["gpt-oss-120b"]),
        root,
      });
      plugin.register(api);
      const report = _getLoadSafetyReportForTest();

      const { createMemoryCLI } = jiti("../cli.ts");
      const { MemoryStore } = jiti("../src/store.ts");
      const program = new Command();
      program.exitOverride();
      const store = new MemoryStore({ dbPath: path.join(root, "doctor-db"), vectorDim: 4 });
      const context = {
        store,
        retriever: { retrieve: async () => [], getConfig: () => ({}) },
        scopeManager: { getDefaultScope: () => "global", getStats: () => ({}) },
        migrator: {},
        embedder: { embedPassage: async () => [0, 0, 0, 0] },
        pluginConfig: { smartExtraction: true, llm: { model: "openai/gpt-oss-120b" } },
        loadSafety: report,
      };
      createMemoryCLI(context)({ program });

      const out = await captureStdout(() =>
        program.parseAsync(["node", "openclaw", "memory-cip", "doctor"]),
      );
      assert.match(out, /load safety: network-at-load=none/);
      assert.match(out, /embedding: model=text-embedding-3-small provider=openai-compatible/);      assert.match(out, /generation LLM: model=openai\/gpt-oss-120b explicit=yes available=available/);
      assert.match(out, /smartExtraction: requested=yes effective=yes/);
    });
  });

  it("reports an unconfirmed/unavailable model honestly in a standalone CLI", async () => {
    await withTempRootAsync(async (root) => {
      const { createMemoryCLI } = jiti("../cli.ts");
      const { MemoryStore } = jiti("../src/store.ts");
      const program = new Command();
      program.exitOverride();
      const store = new MemoryStore({ dbPath: path.join(root, "doctor-db2"), vectorDim: 4 });
      const context = {
        store,
        retriever: { retrieve: async () => [], getConfig: () => ({}) },
        scopeManager: { getDefaultScope: () => "global", getStats: () => ({}) },
        migrator: {},
        embedder: { embedPassage: async () => [0, 0, 0, 0] },
        pluginConfig: { embedding: { model: "text-embedding-3-small" }, smartExtraction: true, llm: { model: "openai/gpt-oss-120b" } },
      };
      createMemoryCLI(context)({ program });
      const out = await captureStdout(() =>
        program.parseAsync(["node", "openclaw", "memory-cip", "doctor"]),
      );
      assert.match(out, /generation LLM: model=openai\/gpt-oss-120b explicit=yes available=unconfirmed/);
      assert.match(out, /smartExtraction: requested=yes effective=no/);
      assert.match(out, /network-at-load=none/);
    });
  });
});

// ---------------------------------------------------------------------------
// load-safety unit coverage (parse / inventory / availability)
// ---------------------------------------------------------------------------

describe("load-safety module units", () => {
  it("parses provider-prefixed and bare refs", () => {
    assert.deepEqual(loadSafety.parseGenerationModelRef("openai/gpt-oss-120b"), {
      modelId: "gpt-oss-120b",
      provider: "openai",
    });
    assert.deepEqual(loadSafety.parseGenerationModelRef("gpt-oss-120b"), { modelId: "gpt-oss-120b" });
    // With a known provider set, a non-provider prefix stays part of the id.
    const providers = new Set(["openrouter"]);
    assert.deepEqual(loadSafety.parseGenerationModelRef("meta-llama/Llama-3.1-8B", providers), {
      modelId: "meta-llama/Llama-3.1-8B",
    });
    assert.deepEqual(loadSafety.parseGenerationModelRef("openrouter/x/y", providers), {
      modelId: "x/y",
      provider: "openrouter",
    });
  });

  it("defaults the effective generation model to the historical reference", () => {
    const resolved = loadSafety.resolveGenerationModel({});
    assert.equal(resolved.modelRef, "openai/gpt-oss-120b");
    assert.equal(resolved.explicit, false);
  });

  it("reads the host inventory from config.models.providers and agents", () => {
    const inventory = loadSafety.resolveHostModelInventory({
      config: {
        models: { providers: { openai: { models: [{ id: "gpt-oss-120b" }] } } },
        agents: { list: [{ id: "main", model: "openai/gpt-4o-mini" }] },
      },
    });
    assert.equal(inventory.confirmed, true);
    assert.ok(inventory.refs.has("openai/gpt-oss-120b"));
    assert.ok(inventory.refs.has("openai/gpt-4o-mini"));
    assert.ok(inventory.providers.has("openai"));
  });

  it("marks an empty surface as unconfirmed", () => {
    const inventory = loadSafety.resolveHostModelInventory({});
    assert.equal(inventory.confirmed, false);
    const availability = loadSafety.evaluateGenerationModelAvailability({
      inventory,
      model: loadSafety.resolveGenerationModel({}),
    });
    assert.equal(availability.status, "unconfirmed");
  });

  it("never throws when api.runtime is a throwing getter", () => {
    const api = { config: {} };
    Object.defineProperty(api, "runtime", {
      get() {
        throw new Error("runtime unavailable in this registration mode");
      },
    });
    assert.doesNotThrow(() => loadSafety.resolveHostModelInventory(api));
    const inventory = loadSafety.resolveHostModelInventory(api);
    assert.equal(inventory.confirmed, false);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function captureStdout(run) {
  const chunks = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  console.log = (...args) => chunks.push(args.join(" "));
  process.stdout.write = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    return true;
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
  return chunks.join("\n");
}

function withTempRootAsync(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "memory-lancedb-cip-loadsafety-"));
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}
