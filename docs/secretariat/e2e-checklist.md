# End-to-end checklist

Run after merging to `secretariat`, before a release, and whenever something touches startup, the
environment guard or logging. Issue #61.

Two parts: a script for the CLI (runs anywhere, including a cloud session) and manual checks for the
desktop app (needs a Mac with a display).

## 1. Build

From the repo root, on Node 24.14.0 (`node -v`; mise sets it inside the repo):

```sh
git checkout secretariat && git pull
pnpm install --frozen-lockfile
pnpm bootstrap                      # workspace packages + the agent CLI the desktop app starts
```

For the CLI only (faster; enough for part 2):

```sh
pnpm exec turbo run build --cwd apps/zcode-cli --filter=@zcode/cli
```

The CLI binary is `apps/zcode-cli/packages/cli/dist/zcode.cjs` (`node <path> …`). The repo root does
not link a `secretariat` command.

## 2. CLI smoke test (script)

```sh
scripts/secretariat/e2e-smoke.sh
```

About 21 checks in a throwaway data directory, no model, network or keys needed, under a minute. It
covers:

- **Environment guard (#8):** headless refuses without or with an invalid `SECRETARIAT_DEPLOYMENT`;
  unregistered and changed credentials are refused; the other environment is refused on a bound
  directory; `deployment register` needs an explicit environment and stores only a fingerprint in a
  0600 file; `deployment status` and error messages never print a key.
- **Logging (#51):** agent lines readable with `logs --service agent --since`, the prompt text never
  reaches a log file, flag validation, `--audit` with no audit log yet.

Expected result: `N passed, 0 failed` and exit code 0.

### With a real model

Needs a model configured in the app's settings for the data directory you point at (default
`~/.secretariat-dev-home`, the one `mise run dev` uses; override with `SECRETARIAT_E2E_DATA_BASE_DIR`):

```sh
scripts/secretariat/e2e-smoke.sh --with-model
```

Adds: `-p` answers in the default `build` mode (#9), and the prompt text isn't in the agent log. This
part uses your shell environment, so if `OPENROUTER_API_KEY`, `BRAVE_API_KEY` or
`SECRETARIAT_GATEWAY_TOKEN` is set, register it for that directory first:

```sh
SECRETARIAT_DEPLOYMENT=test SECRETARIAT_DATA_BASE_DIR=~/.secretariat-dev-home \
  node apps/zcode-cli/packages/cli/dist/zcode.cjs deployment register
```

## 3. Desktop app (manual, Mac)

Use the dev data directory so your normal `~/.secretariat` isn't touched. `mise run dev` runs the app
with `SECRETARIAT_DATA_BASE_DIR=~/.secretariat-dev-home`. (Its `test`/`production` script names are
ZCode's old Z.ai backend switch, not `SECRETARIAT_DEPLOYMENT`.)

| #   | Do                                                                                                        | Expect                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `mise run dev` with `SECRETARIAT_DEPLOYMENT` unset                                                        | App opens. The desktop log (`~/.secretariat-dev-home/.secretariat/v2/logs/`) has `[deployment] test (SECRETARIAT_DEPLOYMENT is not set)`. `~/.secretariat-dev-home/.secretariat/deployment.json` exists with `"deployment": "test"`. |
| D2  | Quit. Start again with `SECRETARIAT_DEPLOYMENT=prod mise run dev`                                         | Error dialog "Secretariat can't start" naming `deployment.json` and the test/prod mismatch. App quits.                                                                                                                               |
| D3  | Quit. Start with `OPENROUTER_API_KEY=anything mise run dev` (unregistered)                                | Error dialog: `OPENROUTER_API_KEY is not registered for the test deployment`. The key's value isn't shown.                                                                                                                           |
| D4  | Start normally. In settings, configure OpenRouter (direct mode) and start a conversation: "Reply with OK" | An answer arrives.                                                                                                                                                                                                                   |
| D5  | In that conversation, ask the agent to create a file in the workspace                                     | The file is created, after an approval prompt if the composer's mode asks for one.                                                                                                                                                   |
| D6  | `node apps/zcode-cli/packages/cli/dist/zcode.cjs logs --service agent --since 10m`                        | Recent agent lines; the text of your D4 prompt doesn't appear.                                                                                                                                                                       |

Known, not failures yet:

- A "client-config: invalid response" or similar message about refreshing built-in provider config:
  the app still fetches it from Z.ai until #46.
- Z.ai login, coding-plan and usage screens are still there until #47–#49.

## Recording a run

Paste the script output and the D1–D6 results into the PR or issue that prompted the run. A failure
gets a bug issue.
