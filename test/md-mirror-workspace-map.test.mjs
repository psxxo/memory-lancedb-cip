import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jitiFactory from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginSdkStubPath = path.resolve(testDir, "helpers", "openclaw-plugin-sdk-stub");
const jiti = jitiFactory(import.meta.url, {
  interopDefault: true,
  alias: {
    "openclaw/plugin-sdk": pluginSdkStubPath,
  },
});

const { resolveAgentWorkspaceMap, createMdMirrorWriter } = jiti("../index.ts");

const FIXED_TS = Date.UTC(2026, 8, 29, 5, 0, 0);
const DATE_STR = "2026-09-29";

function makeApi(agents) {
  const warnings = [];
  const infos = [];

  return {
    api: {
      config: { agents },
      resolvePath: (value) => value,
      logger: {
        info: (message) => infos.push(String(message)),
        warn: (message) => warnings.push(String(message)),
      },
    },
    warnings,
    infos,
  };
}

describe("resolveAgentWorkspaceMap", () => {
  let tmpRoot;
  let savedHome;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "md-mirror-map-"));
    savedHome = process.env.OPENCLAW_HOME;
    // Point the openclaw.json fallback at an empty dir unless a test overrides it.
    process.env.OPENCLAW_HOME = tmpRoot;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = savedHome;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves the current agents.entries map shape", () => {
    const { api } = makeApi({
      entries: {
        main: { workspace: "/ws/main" },
        xiyao: { workspace: "/ws/xiyao" },
      },
    });

    assert.deepEqual(resolveAgentWorkspaceMap(api), {
      main: "/ws/main",
      xiyao: "/ws/xiyao",
    });
  });

  it("still resolves the legacy agents.list array shape", () => {
    const { api } = makeApi({
      list: [
        { id: "main", workspace: "/ws/main" },
        { id: "renamed", workspace: "/ws/renamed" },
      ],
    });

    assert.deepEqual(resolveAgentWorkspaceMap(api), {
      main: "/ws/main",
      renamed: "/ws/renamed",
    });
  });

  it("merges both shapes and lets entries win on conflict", () => {
    const { api } = makeApi({
      list: [
        { id: "main", workspace: "/legacy/main" },
        { id: "legacy-only", workspace: "/legacy/only" },
      ],
      entries: {
        main: { workspace: "/entries/main" },
      },
    });

    assert.deepEqual(resolveAgentWorkspaceMap(api), {
      main: "/entries/main",
      "legacy-only": "/legacy/only",
    });
  });

  it("ignores entries without a usable string workspace", () => {
    const { api } = makeApi({
      entries: {
        main: { workspace: "/ws/main" },
        noWorkspace: {},
        nullEntry: null,
        badWorkspace: { workspace: 42 },
      },
    });

    assert.deepEqual(resolveAgentWorkspaceMap(api), { main: "/ws/main" });
  });

  it("falls back to openclaw.json agents.entries when runtime config is empty", () => {
    writeFileSync(
      path.join(tmpRoot, "openclaw.json"),
      JSON.stringify({
        agents: {
          entries: {
            main: { workspace: "/file/main" },
            jiuyao: { workspace: "/file/jiuyao" },
          },
        },
      }),
      "utf8",
    );

    const { api } = makeApi(undefined);

    assert.deepEqual(resolveAgentWorkspaceMap(api), {
      main: "/file/main",
      jiuyao: "/file/jiuyao",
    });
  });

  it("returns an empty map when no workspace source is available", () => {
    const { api } = makeApi(undefined);

    assert.deepEqual(resolveAgentWorkspaceMap(api), {});
  });
});

describe("createMdMirrorWriter", () => {
  let tmpRoot;
  let workspaceDir;
  let fallbackDir;
  let savedHome;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "md-mirror-write-"));
    workspaceDir = path.join(tmpRoot, "workspace-main");
    fallbackDir = path.join(tmpRoot, "memory-mirror");
    savedHome = process.env.OPENCLAW_HOME;
    process.env.OPENCLAW_HOME = tmpRoot;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = savedHome;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns null when the mirror is disabled", () => {
    const { api } = makeApi({ entries: { main: { workspace: workspaceDir } } });

    assert.equal(createMdMirrorWriter(api, { mdMirror: { enabled: false } }), null);
    assert.equal(createMdMirrorWriter(api, {}), null);
  });

  it("writes into <workspace>/memory/<date>.md for a known agent", async () => {
    const { api } = makeApi({ entries: { main: { workspace: workspaceDir } } });
    const writer = createMdMirrorWriter(api, { mdMirror: { enabled: true, dir: fallbackDir } });

    await writer(
      { timestamp: FIXED_TS, text: "remember this", category: "fact", scope: "agent:main" },
      { agentId: "main", source: "memory_store" },
    );

    const filePath = path.join(workspaceDir, "memory", `${DATE_STR}.md`);
    assert.equal(existsSync(filePath), true);
    assert.match(readFileSync(filePath, "utf8"), /\[fact:agent:main\] agent=main source=memory_store remember this/);
    assert.equal(existsSync(path.join(fallbackDir, `${DATE_STR}.md`)), false);
  });

  it("falls back to the configured dir when the agent workspace is unknown", async () => {
    const { api, warnings } = makeApi(undefined);
    const writer = createMdMirrorWriter(api, { mdMirror: { enabled: true, dir: fallbackDir } });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no agent workspaces found/);

    await writer(
      { timestamp: FIXED_TS, text: "orphan row", category: "fact", scope: "global" },
      { agentId: "unknown-agent", source: "memory_store" },
    );

    const filePath = path.join(fallbackDir, `${DATE_STR}.md`);
    assert.equal(existsSync(filePath), true);
    assert.match(readFileSync(filePath, "utf8"), /orphan row/);
  });

  it("logs the resolved workspace count instead of warning", () => {
    const { api, warnings, infos } = makeApi({ entries: { main: { workspace: workspaceDir } } });

    createMdMirrorWriter(api, { mdMirror: { enabled: true, dir: fallbackDir } });

    assert.equal(warnings.length, 0);
    assert.equal(infos.length, 1);
    assert.match(infos[0], /resolved 1 agent workspace/);
  });
});
