# Release Checklist

Use this checklist before publishing a new `memory-lancedb-cip` package. It is
intended for the release tracked in #812 and future beta/stable cuts.

> **Before you start:** follow the ordered runbook [`docs/notes/release-runbook.md`](notes/release-runbook.md)
> (pre-flight cleanup → prepare → verify → push → publish → **wait for scans** → cleanup).
> The three non-negotiables: single-flight, capture output to a file, and wait after submit.

## Release Target

- Current package version: `1.1.0-beta.11`
- Recommended first publish: beta dist-tag
- Stable channel decision: maintainer-owned after beta smoke testing

The current release driver is that npm users are still behind repository
`master`: merged fixes are not available from the published `latest` package,
and the `beta` dist-tag still points at an older beta package.

## Preflight

Run these from a clean checkout:

```bash
npm ci
npm run test:packaging-and-workflow
npm run build
npm pack --dry-run
```

Confirm:

- `package.json` and `openclaw.plugin.json` versions match
- `package.json main` points at `dist/index.js`
- `package.json openclaw.extensions` points at `./dist/index.js`
- `package.json files` includes `dist/**/*`
- `CHANGELOG.md` and `CHANGELOG-v1.1.0.md` start with the package version
- `npm pack --dry-run` includes compiled `dist` output and excludes test files

## Documentation (ships in the SAME release)

Documentation is part of the release, never a follow-up. Confirm before publishing:

- every `README*.md` — all languages — carries the current version's "what's new" section; a release
  that adds or changes behaviour must not ship with READMEs still describing the previous version;
- `docs/FEATURES.md` matches the manifest `configSchema` (it is the authoritative feature list, since
  the READMEs under-report the real surface);
- no README still shows a removed default (e.g. a built-in model id) in its configuration example;
- every README links `docs/FEATURES.md`;
- `docs/notes/extraction-realtime-lane-A.md` matches the shipped code — triggers, transport
  resolution, queue semantics, and runbook (a behaviour change updates it in the same release);
- **three points in one line**: the plugin manifest `configSchema`, `docs/FEATURES.md`, and every
  `README*.md` (all 11 languages) describe the same feature surface — a feature added, renamed, or
  removed must be reflected in all three in the same release.

If any of these is missing, finish it in the same cycle — do not publish first and patch the docs
afterwards.

## Publish Dry Run

```bash
npm publish --tag beta --dry-run
```

Review the file list and package metadata before publishing.

## Publish

```bash
npm publish --tag beta
```

After publish, verify the public registry state:

```bash
npm view @psxxo/lancedb-cip dist-tags version versions --json
npm view @psxxo/lancedb-cip@beta version main openclaw files --json
```

The `beta` dist-tag should point at the newly published version, and the package
runtime entries should point at compiled JavaScript under `dist/`.

## Post-Publish Smoke

On a machine with a current OpenClaw install:

```bash
openclaw plugins registry --refresh
openclaw plugins install clawhub:@psxxo/lancedb-cip
openclaw plugins doctor
```

Confirm OpenClaw installs the package without falling back to TypeScript source
entrypoints.
