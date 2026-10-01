import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createLlmClient, resetHostWorkScopeCacheForTests, setHostWorkScopeCtorForTests } = jiti(
  "../src/llm-client.ts",
);

function hostClient(runtimeComplete) {
  return createLlmClient({
    transport: "host",
    model: "",
    modelExplicit: false,
    runtimeLlmComplete: runtimeComplete,
    timeoutMs: 5000,
  });
}

describe("host transport async work scope", () => {
  afterEach(() => setHostWorkScopeCtorForTests(null));

  it("enters a fresh async work scope around the host completion", async () => {
    const events = [];
    class FakeScope {
      track(run) {
        events.push("track");
        return run();
      }
    }
    setHostWorkScopeCtorForTests(FakeScope);
    const llm = hostClient(async () => ({ text: '{"memories":[]}' }));
    assert.deepEqual(await llm.completeJson("hello", "scope-probe"), { memories: [] });
    assert.deepEqual(events, ["track"]);
  });

  it("wraps the text lane too", async () => {
    const events = [];
    class FakeScope {
      track(run) {
        events.push("track");
        return run();
      }
    }
    setHostWorkScopeCtorForTests(FakeScope);
    const llm = hostClient(async () => ({ text: "plain text" }));
    assert.equal(await llm.completeText("hello", "text-probe"), "plain text");
    assert.deepEqual(events, ["track"]);
  });

  it("still calls the host when the scope helper is unavailable", async () => {
    setHostWorkScopeCtorForTests(null);
    let called = 0;
    const llm = hostClient(async () => {
      called += 1;
      return { text: '{"memories":[]}' };
    });
    assert.deepEqual(await llm.completeJson("hello", "no-scope"), { memories: [] });
    assert.equal(called, 1);
  });

  it("survives a missing concurrency-runtime subpath", async () => {
    resetHostWorkScopeCacheForTests();
    let called = 0;
    const llm = hostClient(async () => {
      called += 1;
      return { text: '{"memories":[]}' };
    });
    assert.deepEqual(await llm.completeJson("hello", "missing-subpath"), { memories: [] });
    assert.equal(called, 1);
  });

  it("falls back to an unwrapped call when scope construction throws", async () => {
    class ExplodingScope {
      constructor() {
        throw new Error("scope unavailable");
      }
    }
    setHostWorkScopeCtorForTests(ExplodingScope);
    let called = 0;
    const llm = hostClient(async () => {
      called += 1;
      return { text: '{"memories":[]}' };
    });
    assert.deepEqual(await llm.completeJson("hello", "boom"), { memories: [] });
    assert.equal(called, 1);
  });
});
