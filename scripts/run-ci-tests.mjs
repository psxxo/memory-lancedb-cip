import { spawn } from "node:child_process";
import { CI_TEST_MANIFEST, getEntriesForGroup } from "./ci-test-manifest.mjs";

function parseArgs(argv) {
  if (argv.includes("--all")) {
    return { mode: "all" };
  }

  const idx = argv.indexOf("--group");
  if (idx !== -1 && argv[idx + 1]) {
    return { mode: "group", group: argv[idx + 1] };
  }

  throw new Error("Usage: node scripts/run-ci-tests.mjs --all | --group <name>");
}

function buildCommand(entry) {
  return [entry.runner, ...(entry.args ?? []), entry.file];
}

async function runEntry(entry) {
  const [cmd, ...args] = buildCommand(entry);
  const printable = [cmd, ...args].join(" ");
  console.log(`==> ${printable}`);

  // Run every entry with the Gateway logging path. OPENCLAW_CLI downgrades the
  // plugin's registration logs to debug (logReg / #888), so a runner started
  // from an OpenClaw agent shell would otherwise produce environment-only
  // failures that never reproduce in CI.
  const env = { ...process.env };
  delete env.OPENCLAW_CLI;

  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${entry.file} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const entries = parsed.mode === "all" ? CI_TEST_MANIFEST : getEntriesForGroup(parsed.group);

  for (const entry of entries) {
    await runEntry(entry);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
