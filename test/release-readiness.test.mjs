import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CI_TEST_MANIFEST } from "../scripts/ci-test-manifest.mjs";

function readText(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const pkg = readJson("package.json");
const manifest = readJson("openclaw.plugin.json");
const releaseChecklist = readText("docs/release-checklist.md");

assert.equal(pkg.version, manifest.version, "package and plugin manifest versions must match before release");
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "release version must be an explicit semver");
assert.equal(
  pkg.version,
  manifest.version,
  "package.json and openclaw.plugin.json versions must stay aligned",
);

for (const changelogPath of ["CHANGELOG.md", "CHANGELOG-v1.1.0.md"]) {
  const changelog = readText(changelogPath);
  assert.match(
    changelog,
    new RegExp(`^## ${escapeRegExp(pkg.version)}\\b`),
    `${changelogPath} should start with the package version`,
  );
}

assert.equal(pkg.main, "dist/index.js");
assert.deepEqual(pkg.openclaw?.extensions, ["./dist/index.js"]);
assert.ok(pkg.files?.includes("dist/**/*"), "published files should include compiled dist output");
assert.ok(pkg.files?.includes("docs/**/*.md"), "release checklist should be included in package docs");

assert.match(releaseChecklist, /npm run test:packaging-and-workflow/);
assert.match(releaseChecklist, /npm pack --dry-run/);
assert.match(releaseChecklist, /npm publish --tag beta --dry-run/);
assert.match(releaseChecklist, /npm view @psxxo/memory-lancedb-cip@beta version main openclaw files --json/);

assert.ok(
  CI_TEST_MANIFEST.some((entry) => entry.file === "test/release-readiness.test.mjs"),
  "release readiness test should run in CI packaging workflow",
);
