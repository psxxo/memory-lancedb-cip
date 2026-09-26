// test/workspace-memory-provenance.test.mjs
//
// Host memory-runtime contract: `supportsWorkspaceMemoryReadSources` +
// `classifyWorkspaceMemoryPaths` on the memory capability runtime.
//
// The host (`dist/memory-runtime-*.mjs::classifyActiveMemoryWorkspacePaths`)
// only returns `{ status: "classified" }` when the plugin runtime exposes
// `classifyWorkspaceMemoryPaths`, and only honors `readSources` when it also
// advertises `supportsWorkspaceMemoryReadSources`. Automatic prompt injection
// of MEMORY.md / USER.md is then reserved for originClass 'owner' | 'agent',
// so this test pins our classification table:
//
//   USER.md                -> owner
//   MEMORY.md | memory.md  -> agent
//   memory/** (daily notes, dreaming/**, .dreams/) -> agent
//   any other root file / unreadable / outside workspace / invalid -> untrusted
//
// Fixtures are synthetic (temp workspace); there is no live gateway, no store,
// and no network.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createOpenClawMemoryCapability } = jiti("../src/openclaw-memory-capability.ts");

const tmpRoot = mkdtempSync(path.join(tmpdir(), "memory-provenance-"));
const workspaceDir = path.join(tmpRoot, "ws");

function seed(relativePath, contents = "# fixture\n") {
  const absolutePath = path.join(workspaceDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
  return relativePath;
}

seed("USER.md", "# User\n");
seed("MEMORY.md", "# Memory\n");
seed("memory.md", "# Memory (lowercase)\n");
seed("memory/2026-01-01.md", "# Daily\n");
seed("memory/dreaming/x.md", "# Dream\n");
seed("memory/.dreams/events.jsonl", "{}\n");
seed("unknown.md", "# Unknown root\n");
// A real file OUTSIDE the workspace, so the traversal case exercises the
// strictly-inside guard rather than mere nonexistence.
writeFileSync(path.join(tmpRoot, "outside.md"), "# Outside\n", "utf8");

const capability = createOpenClawMemoryCapability({
  dbPath: path.join(tmpRoot, "db"),
  vectorDim: 4,
  embeddingProvider: "openai-compatible",
  embeddingModel: "test-embedding-model",
  workspaceDir,
  getRuntimeStatus() {
    return { embeddingAvailable: false, retrievalAvailable: false };
  },
  async probeEmbeddingAvailability() {
    return { ok: false };
  },
  async probeVectorAvailability() {
    return false;
  },
});

function classify(relativePaths, extra = {}) {
  return capability.runtime.classifyWorkspaceMemoryPaths({
    agentId: "main",
    workspaceDir,
    relativePaths,
    ...extra,
  });
}

try {
  // --- two contract members are advertised -------------------------------
  assert.equal(
    capability.runtime.supportsWorkspaceMemoryReadSources,
    true,
    "runtime must advertise supportsWorkspaceMemoryReadSources",
  );
  assert.equal(
    typeof capability.runtime.classifyWorkspaceMemoryPaths,
    "function",
    "runtime must expose classifyWorkspaceMemoryPaths",
  );

  // --- classification table (no readSources) -----------------------------
  const single = async (relativePath, expected) => {
    const result = await classify([relativePath]);
    assert.equal(result.length, 1, `expected exactly one classification for ${relativePath}`);
    assert.equal(result[0].relativePath, relativePath, "relativePath must be echoed back");
    assert.equal(result[0].originClass, expected, `${relativePath} should classify as ${expected}`);
  };

  await single("USER.md", "owner");
  await single("MEMORY.md", "agent");
  await single("memory.md", "agent");
  await single("memory/2026-01-01.md", "agent");
  await single("memory/dreaming/x.md", "agent");
  await single("memory/.dreams/events.jsonl", "agent");
  await single("unknown.md", "untrusted");

  // --- invalid / unreadable / outside-workspace paths ---------------------
  await single("../outside.md", "untrusted");
  await single("..", "untrusted");
  await single(".", "untrusted");
  await single(path.join(workspaceDir, "MEMORY.md"), "untrusted"); // absolute posix
  await single("C:\\Users\\x\\MEMORY.md", "untrusted"); // absolute win32
  await single("memory\\2026-01-01.md", "untrusted"); // backslash
  await single("./MEMORY.md", "untrusted"); // non-normalized
  await single("does-not-exist.md", "untrusted"); // unreadable
  await single("", "untrusted"); // empty

  // --- readSources: canonical path is honored -----------------------------
  const canonical = await classify(["AGENTS.md", "MEMORY.md", "notes.txt"], {
    readSources: [
      { relativePath: "AGENTS.md", canonicalRelativePath: "USER.md" },
      { relativePath: "MEMORY.md", canonicalRelativePath: "memory/2026-01-01.md" },
      { relativePath: "notes.txt", canonicalRelativePath: "unknown.md" },
    ],
  });
  assert.deepEqual(
    canonical.map((entry) => [entry.relativePath, entry.originClass]),
    [
      ["AGENTS.md", "owner"],
      ["MEMORY.md", "agent"],
      ["notes.txt", "untrusted"],
    ],
    "readSources canonical paths must drive classification",
  );

  // --- invalid / missing readSource entries -> untrusted ------------------
  for (const bad of ["", ".", "..", "../x", "/etc/passwd", "C:\\x", "a\\b", "./x", "memory/../x"]) {
    const [result] = await classify(["MEMORY.md"], {
      readSources: [{ relativePath: "MEMORY.md", canonicalRelativePath: bad }],
    });
    assert.equal(result.originClass, "untrusted", `invalid readSource ${JSON.stringify(bad)} must be untrusted`);
  }

  const missing = await classify(["MEMORY.md"], {
    readSources: [{ relativePath: "other.md", canonicalRelativePath: "USER.md" }],
  });
  assert.equal(missing[0].originClass, "untrusted", "missing readSource entry must be untrusted");
  assert.equal(missing[0].relativePath, "MEMORY.md", "requested relativePath must be preserved");

  // A requested path with no matching readSource does not fall back to disk.
  const noMatch = await classify(["MEMORY.md"], {
    readSources: [{ relativePath: "AGENTS.md", canonicalRelativePath: "USER.md" }],
  });
  assert.equal(noMatch[0].originClass, "untrusted", "unmatched readSources must not fall back to the filesystem");

  // --- order preserved for multiple paths ---------------------------------
  const requested = ["unknown.md", "USER.md", "memory/dreaming/x.md", "MEMORY.md", "../outside.md"];
  const ordered = await classify(requested);
  assert.deepEqual(
    ordered.map((entry) => entry.relativePath),
    requested,
    "classifications must preserve the requested order",
  );
  assert.deepEqual(
    ordered.map((entry) => entry.originClass),
    ["untrusted", "owner", "agent", "agent", "untrusted"],
  );

  // --- never throws; empty input tolerated --------------------------------
  assert.deepEqual(await classify([]), []);
  const absentWorkspace = await capability.runtime.classifyWorkspaceMemoryPaths({
    agentId: "main",
    workspaceDir: path.join(tmpRoot, "no-such-workspace"),
    relativePaths: ["MEMORY.md"],
  });
  assert.equal(absentWorkspace[0].originClass, "untrusted", "unreadable workspace must degrade to untrusted");

  console.log("OK: workspace memory provenance test passed");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
