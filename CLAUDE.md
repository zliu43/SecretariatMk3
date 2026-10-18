# Secretariat Mk3

A personal secretary agent built on a hard fork of ZCode v3.15.1 (`zai-org/ZCode`, Apache-2.0).
It works through its own Google/Slack/Discord/WhatsApp accounts under permission tiers T0–T4.

- Plan, decisions, targets: `docs/secretariat/PLAN.md`
- What's done and known gotchas: `docs/secretariat/PROGRESS.md`
- Open work: GitHub Issues, grouped by milestone (M0–M5). `docs/secretariat/TODO.md` only points there.

The inherited ZCode engineering rules (architecture governance, spec-first, UI and process boundaries)
are in `AGENTS.md` (Chinese) and still apply:

@AGENTS.md

## Workflow

1. **Every change starts from an issue.** If there isn't one, create it (task or bug template) and put it
   in the right milestone.
2. **Branch from `secretariat`**, named `<type>/<issue>-<slug>`, e.g. `task/12-remove-zai-login`.
   `secretariat` is the default branch and is protected: changes land only through pull requests.
3. **Open a PR into `secretariat`** with `Fixes #<issue>` in the description, so merging closes the issue.
   Fill in the PR template's testing section truthfully.
4. **CI must pass** (`.github/workflows/ci.yml`): lint, architecture check on changed files, typecheck
   (main workspace and agent CLI), and unit tests affected by the PR.
5. **Claude reviews the PR** automatically when it's opened (`claude-review.yml`). Address blocking
   comments; comment `@claude review` to get a fresh review after new commits.
6. **Merge**, then update `docs/secretariat/PROGRESS.md` when a milestone item is finished.

The full unit suite runs after every merge and nightly (`full-tests.yml`). If it fails, open a bug issue
rather than ignoring it.

## Branches and releases

- `secretariat` is the working branch. All day-to-day PRs target it.
- `main` holds stable releases only, every 2–4 weeks when a milestone (or a solid part of one) is done.
  Never commit to `main` directly and never target it with feature PRs.
- To release: check the latest `Full unit tests` run on `secretariat` is green (or its failures are
  tracked and accepted), open a PR from `secretariat` into `main` titled `Release vX.Y.0`, merge it with
  a merge commit, then tag the merge `vX.Y.0` and add a release note listing the closed issues.
- A fix needed on a release goes to `secretariat` first, then into `main` with the next release.

Mention `@claude` in an issue or PR comment to have the GitHub bot answer a question or implement a
change; it works on a branch and opens a PR like anyone else.

## Commands

Run from the repo root. Node must be the version pinned in `mise.toml` (24.14.0); Node 25 breaks tests.

| What                  | Command                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| Install               | `pnpm install --frozen-lockfile`                                                        |
| Lint                  | `pnpm lint`                                                                             |
| Typecheck (main)      | `pnpm typecheck`                                                                        |
| Typecheck (agent CLI) | `pnpm exec turbo run typecheck --cwd apps/zcode-cli`                                    |
| Architecture check    | `pnpm architecture:check --changed` (local edits) or `--base=<ref>` (a branch)          |
| Affected unit tests   | `pnpm test:unit:affected` (set `SECRETARIAT_AFFECTED_TEST_BASE=<ref>` to pick the base) |
| One test file         | `pnpm exec vitest run <path>`                                                           |

Don't run the whole unit suite in one process; it can crash Node near the end. Use
`pnpm exec vitest run --shard=<n>/8` or the affected-tests command.

`pnpm fmt:check` is not enforced: most upstream files were never formatted. Format only files you touch
(`pnpm exec oxfmt <files>`).

## Conventions

- Write new docs, comments and commit messages in English; this overrides `AGENTS.md`'s rule of
  writing bug-fix comments in Chinese. Leave existing Chinese text alone unless you're rewriting that
  code anyway.
- Keep ZCode attribution in `NOTICE.md`. Package names stay `@zcode/*`.
- Never add real account credentials, tokens or personal data to the repo, fixtures or logs. Test and
  prod are separated by `SECRETARIAT_DEPLOYMENT=test|prod`.
