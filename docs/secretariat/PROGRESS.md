# Secretariat Mk3 — Progress

Running log of what's done. Plan and decisions: [PLAN.md](PLAN.md). Upcoming work: [TODO.md](TODO.md).

_Last updated: 2026-10-18_

## Status

| Milestone | Status | Notes |
|---|---|---|
| Planning | **Done** | Base chosen, task catalog, tiers, benchmarks, decisions (PLAN.md) |
| M0 — Foundation | **In progress** | Fork builds, tests pass, rename done; Z.ai removal, OpenRouter, container, `/halt` not started |
| M1 — Google read + Slack + brief | Not started | Waiting on test accounts |
| M2 — Tier engine + intake/triage | Not started | |
| M3 — Calendar + Discord | Not started | |
| M4 — Coding delegation + WhatsApp + memory | Not started | |
| M5 — Dogfood | Not started | |

## Repository

- GitHub: `zliu43/SecretariatMk3`, branch `secretariat` (pushed). `main` only holds GitHub's starter LICENSE commit.
- Local: `~/Projects/SecretariatMK3`. Remote `upstream` = `zai-org/ZCode` (reference only, hard fork).
- Base: ZCode v3.15.1 (`aac4755`), Apache-2.0. Original code kept on branch `zcode-v3.15.1`.

## Log

### 2026-10-18
- Development workflow: GitHub Actions CI (lint, architecture, typecheck, affected tests on every PR;
  full suite in 8 shards after merge and nightly), Claude PR review and `@claude` mentions, issue/PR
  templates, English `CLAUDE.md`. TODO items moved to GitHub Issues #1–#37 under milestones M0–M5.
- First Linux run of the full suite: 8 failing tests, tracked in #37.

### 2026-10-16
- Unit tests green: 18,125 passed (pre-push hook passes). Fixed rename side effects the tests caught:
  - HTTP headers restored to `X-ZCode-*` (sender had been renamed, readers hadn't).
  - Deep links: one-slash, no-slash, URL-encoded and double-encoded `secretariat:` forms.
  - `-DZCODE_*` / `/DZCODE_*` compiler defines for CMake and NSIS (Windows native-search build, installer).
  - E2E process matcher, Windows install-dir path, names after `\n`/`\t` escapes.
- Made one time-zone-dependent test (usage panel date) pass in any time zone.
- Replaced the empty-conversation watermark (light outline + dark `Z.svg`) with an outlined S.
- Toolchain: Node must be the pinned 24.14.0 (via mise). Node 25's built-in `localStorage` breaks ~25 jsdom tests.
- Pushed `secretariat` to GitHub.

### 2026-10-15
- Renamed ZCode identity and branding to Secretariat (`rename_secretariat.py`, ~2,700 files):
  data dir `~/.secretariat`, `SECRETARIAT_*` env vars, app name/userData, app ID `dev.secretariat.app`,
  `secretariat://` links, `secretariat` CLI and caches, UI and system-prompt text.
  Kept: `@zcode/*` package names, file names, code identifiers, `.zcode-plugin` manifest dir, Z.ai code, license/notice files.
- Typecheck clean for the main workspace and all agent-CLI packages.
- Replaced the Z logo with an S in the welcome/about logo, startup loader, About window and loading screens.
- Confirmed the fork builds and runs on the Mac.
- Decided test/prod structure, Google account type ("In production" personal Gmail), Brave search, `/pause` + `/halt`.

### 2026-10-14
- Chose ZCode as the base; cloned it; wrote the plan (task catalog, permission tiers, milestones, benchmarks).
- Decisions: OpenRouter (model-agnostic, measured), subscription token for Claude Code with OpenRouter fallback,
  agent works only through its own accounts, Slack primary / Discord + WhatsApp secondary, container deploy.

## Known issues and gotchas

- **Use the pinned Node.** `node -v` must print `v24.14.0` inside the repo (mise activated in fish). Node 25 breaks tests.
- **Full test run can crash Node** (V8 fatal error near the end of the suite) and the JSON reporter segfaults; the
  pre-push affected-test run completes. Run subsets when debugging.
- **Z.ai login is broken** on purpose (its callback now targets `secretariat://`); it's being removed in M0.
- **Headless `-p` mode defaults to `yolo`** (no approvals). Must be overridden before any run touches real accounts.
- **Cloud sessions** can push once the repo is added to the session (Claude GitHub App installed), but can't change repo settings (default branch, branch protection, secrets); do those on github.com.
- `SECRETARIAT_ENV` is ZCode's Z.ai backend selector (test/production), not our test/prod switch — ours is `SECRETARIAT_DEPLOYMENT`.
