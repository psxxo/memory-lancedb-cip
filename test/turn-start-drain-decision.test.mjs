import assert from "node:assert/strict";
import { describe, it } from "node:test";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  DEFAULT_TURN_START_DRAIN_MIN_INTERVAL_MS,
  decideTurnStartDrain,
  resolveTurnSessionKey,
} = jiti("../src/turn-start-drain.ts");

function base(overrides = {}) {
  return {
    trigger: "user",
    sessionKey: "agent:main:webchat:s1",
    queuedTurns: 4,
    drainInFlight: false,
    smartExtractionEnabled: true,
    rateLimited: false,
    now: 1_000_000,
    ...overrides,
  };
}

describe("turn-start extraction drain decision", () => {
  it("drains the speaking session when it has queued texts", () => {
    assert.deepEqual(decideTurnStartDrain(base()), { drain: true, reason: "drain" });
  });

  it("stays off when smart extraction is unavailable", () => {
    assert.deepEqual(
      decideTurnStartDrain(base({ smartExtractionEnabled: false })),
      { drain: false, reason: "disabled" },
    );
  });

  it("stays off for the scheduled extraction turn (the tool drains it)", () => {
    assert.deepEqual(
      decideTurnStartDrain(base({ scheduledExtractionTurn: true })),
      { drain: false, reason: "scheduled-turn" },
    );
  });

  it("stays off without a resolvable session key", () => {
    for (const sessionKey of [undefined, "", "   "]) {
      assert.deepEqual(
        decideTurnStartDrain(base({ sessionKey })),
        { drain: false, reason: "no-session" },
      );
    }
  });

  it("stays off when the session has nothing queued", () => {
    assert.deepEqual(
      decideTurnStartDrain(base({ queuedTurns: 0 })),
      { drain: false, reason: "nothing-queued" },
    );
  });

  it("does not run two drains at once", () => {
    assert.deepEqual(
      decideTurnStartDrain(base({ drainInFlight: true })),
      { drain: false, reason: "already-in-flight" },
    );
  });

  it("respects the hourly extraction budget", () => {
    assert.deepEqual(
      decideTurnStartDrain(base({ rateLimited: true })),
      { drain: false, reason: "rate-limited" },
    );
  });

  it("honours an optional per-session throttle but not by default", () => {
    assert.equal(DEFAULT_TURN_START_DRAIN_MIN_INTERVAL_MS, 0);
    assert.deepEqual(
      decideTurnStartDrain(base({ lastDrainAt: 999_000, minIntervalMs: 0 })),
      { drain: true, reason: "drain" },
    );
    assert.deepEqual(
      decideTurnStartDrain(base({ lastDrainAt: 999_000, minIntervalMs: 60_000 })),
      { drain: false, reason: "throttled" },
    );
    assert.deepEqual(
      decideTurnStartDrain(base({ lastDrainAt: 900_000, minIntervalMs: 60_000 })),
      { drain: true, reason: "drain" },
    );
  });
});

describe("turn-start session key resolution", () => {
  it("prefers ctx.sessionKey then event.sessionKey", () => {
    assert.equal(
      resolveTurnSessionKey({ sessionKey: "from-event" }, { sessionKey: "from-ctx" }),
      "from-ctx",
    );
    assert.equal(resolveTurnSessionKey({ sessionKey: "from-event" }, {}), "from-event");
  });

  it("falls back to the sessionId, through the alias map when present", () => {
    assert.equal(resolveTurnSessionKey({}, { sessionId: "plain-id" }), "plain-id");
    assert.equal(
      resolveTurnSessionKey(
        {},
        { sessionId: "raw-id" },
        (id) => (id === "raw-id" ? "member:main:webchat" : undefined),
      ),
      "member:main:webchat",
    );
  });

  it("returns an empty string when no session is available", () => {
    assert.equal(resolveTurnSessionKey(undefined, undefined), "");
    assert.equal(resolveTurnSessionKey({}, { sessionId: "   " }), "");
  });
});
