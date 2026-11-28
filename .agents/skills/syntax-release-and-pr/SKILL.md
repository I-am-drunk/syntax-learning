---
name: syntax-release-and-pr
description: Author T3 Code-style pull requests, conventional commits, and Nightly/Stable releases for syntax-platform/syntax. Use whenever opening a PR, preparing release notes, or triggering a Syntax Stable or Syntax Dev release.
---

# Syntax PR & Release Authoring Guide

Syntax uses a single-source-of-truth release pipeline in `syntax-platform/syntax` modeled after `pingdotgg/t3code`:

- **Syntax Stable (`https://syntax-platform.github.io/syntax/`)**: Published from `vX.Y.Z` releases in `syntax-platform/syntax`. Dispatch Stable from `main` with an exact commit SHA that matches the maintainer's `SYNTAX_STABLE_APPROVED_SHA` repository variable.
- **Syntax Dev (`https://syntax-platform.github.io/syntax-dev/`)**: Automated Nightly pre-releases (`vX.Y.Z-nightly.YYYYMMDD.<run>`) cut from `main` and cross-deployed to `syntax-platform/syntax-dev`'s `gh-pages` branch via a least-privilege deploy key (`SYNTAX_DEV_DEPLOY_KEY`).
- **Preview (`channel=preview`)**: Manual dry-run build from any branch; stays a draft release and never touches live sites.

## Writing PR Titles & Bodies for Great Automated Release Notes

`scripts/generate-release-notes.mjs` reads commit subjects + the first 300 characters of each PR's prose (stripping `## Verification` / screenshots) to produce T3-style release notes:
- Header: `**vX.Y.Z** · N changes from M contributors`
- Up to 7 high-signal user-facing bullets (`- **Feature Name.** Plain-English outcome in <= 20 words.`)
- Deterministic remaining count: `### Plus N more bug fixes.`
- Collapsible `<details><summary>Full changelog</summary>...</details>`

Follow these rules on every PR:
1. **Use conventional commit titles in plain English** describing the user outcome:
   - Good: `feat(pen): persist per-question ink strokes across step switches`
   - Good: `fix(graph): prevent label overlap on steep perpendicular lines`
   - Bad: `update files` or `fix bug`
2. **Prefix accurately** so remaining counts stay truthful:
   - `feat(scope):` for new user capabilities
   - `fix(scope):` for bug fixes (counted in `Plus N more bug fixes.`)
   - `perf(scope):` for performance wins (counted in `performance improvements`)
   - `security(scope):` for security hardening
   - `chore(scope):`, `docs(scope):`, `refactor(scope):`, `test(scope):` for internal work skipped from top bullets
3. **Keep `## Problem` and `## Change` concise and user-focused** (no em dashes, no implementation noise in the first paragraph).
4. **Always fill `## Verification`** with exact commands (`npm run build`, `npm run verify:graphs`) and observed results.

## Triggering Releases

- **Cut a Syntax Dev (Nightly) pre-release now:**
  ```bash
  gh workflow run release.yml --repo syntax-platform/syntax -f channel=nightly
  ```
- **Publish an explicitly approved commit to Syntax Stable:**
  ```bash
  gh workflow run release.yml --repo syntax-platform/syntax -f channel=stable -f commit=<approved-sha>
  ```
  (Optional: pass `-f version=0.3.0` to override the semver tag.)
- **Preview release notes locally before cutting a release:**
  ```bash
  node scripts/generate-release-notes.mjs --repository syntax-platform/syntax --previous-tag v0.2.0 --ref main --tag v0.3.0 --version 0.3.0 --dry-run
  ```
- **Pause automatic 6-hour Nightlies** without editing workflows: set repository variable `PAUSE_NIGHTLY=true` on `syntax-platform/syntax`.
