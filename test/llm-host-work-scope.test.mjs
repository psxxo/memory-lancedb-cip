import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, describe, it } from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createLlmClient, resetHostWorkScopeCacheForTests, setHostWorkScopeCtorForTests } = jiti(
  "../src/llm-client.ts",
);

function hostClient(runtimeComplete, extra = {}) {
  return createLlmClient({
    transport: "host",
    model: "",
    modelExplicit: false,
    runtimeLlmComplete: runtimeComplete,
    timeoutMs: 5000,
    ...extra,
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

  describe("post-turn authority fallback", () => {
    let server;
    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
        server = null;
      }
    });

    async function startServer(payload) {
      server = http.createServer(async (req, res) => {
        for await (const _ of req) {
          // drain
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server.address().port;
    }

    it("retries on the plugin fallback lane when the host authority has ended", async () => {
      const port = await startServer({ choices: [{ message: { content: '{"memories":["fallback"]}' } }] });
      let hostCalls = 0;
      const llm = hostClient(
        async () => {
          hostCalls += 1;
          throw new Error("agent tool caller authority is no longer active");
        },
        { fallback: { model: "fallback-model", apiKey: "***", baseURL: `http://127.0.0.1:${port}/v1`, timeoutMs: 5000 } },
      );
      assert.deepEqual(await llm.completeJson("hello", "authority-probe"), { memories: ["fallback"] });
      assert.equal(hostCalls, 1);
    });

    it("does not use the fallback lane for unrelated host failures", async () => {
      const port = await startServer({ choices: [{ message: { content: '{"memories":["fallback"]}' } }] });
      let fallbackHits = 0;
      server.on("request", () => {
        fallbackHits += 1;
      });
      const llm = hostClient(
        async () => {
          throw new Error("socket hang up");
        },
        { fallback: { model: "fallback-model", apiKey: "***", baseURL: `http://127.0.0.1:${port}/v1`, timeoutMs: 5000 } },
      );
      assert.equal(await llm.completeJson("hello", "transient-probe"), null);
      assert.equal(fallbackHits, 0);
    });

    it("keeps the host lane when no fallback is configured", async () => {
      let hostCalls = 0;
      const llm = hostClient(async () => {
        hostCalls += 1;
        throw new Error("agent tool caller authority is no longer active");
      });
      assert.equal(await llm.completeJson("hello", "no-fallback"), null);
      assert.equal(hostCalls, 1);
    });
  });
});
