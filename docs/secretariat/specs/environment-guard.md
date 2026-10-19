# Environment guard

Issue #8. Plan: PLAN.md §6 (principles 1–2), task O9.

## Goal

A test run must never touch prod data or prod credentials, and the reverse. The guard runs at startup,
before anything else starts, and refuses to run on any mismatch.

## Declared environment

`SECRETARIAT_DEPLOYMENT` is `test` or `prod`. Any other value is an error.

| Entry                                                                                            | When unset               |
| ------------------------------------------------------------------------------------------------ | ------------------------ |
| Headless and server: `secretariat -p`, `--target`, `app-server`, `agent-server`, `@zcode/server` | Refuse to start          |
| Interactive: desktop app, `secretariat` / `secretariat tui`                                      | Run as `test` and say so |

"Say so": the TUI prints `Environment: test (SECRETARIAT_DEPLOYMENT is not set)` before it opens; the
desktop app writes it to its log. The desktop app sets the resolved value in its own environment, so
every agent process it starts inherits an explicit `SECRETARIAT_DEPLOYMENT`.

Commands that don't run the agent (`help`, `version`, `doctor`, `plugins`, `skills`, `commands`) are not
guarded.

## Data directory binding

The data directory is `$SECRETARIAT_DATA_BASE_DIR/.secretariat` (home directory if unset). It holds
`deployment.json`:

```json
{
  "version": 1,
  "deployment": "test",
  "credentials": { "OPENROUTER_API_KEY": "sha256:…" }
}
```

- Missing file: the guard creates it with the declared environment and no credentials. Creation is
  exclusive, so two processes starting together on a fresh directory can't both bind it.
- Each process checks the data directory it actually stores data in. The desktop app's custom data
  directory setting isn't passed to the agents it starts (they use `SECRETARIAT_DATA_BASE_DIR` or the
  home directory), so the two directories can differ; each is bound separately, and both to the
  environment the desktop passes down.
- `deployment` differs from the declared environment: refuse to start.
- Unreadable or invalid file: refuse to start. The guard never overwrites it.

## Credential binding

Guarded credentials are the environment variables that hold secrets for outside services:
`OPENROUTER_API_KEY`, `BRAVE_API_KEY`, `SECRETARIAT_GATEWAY_TOKEN`. The list grows as integrations are
added. Credentials kept elsewhere (for example the desktop app's credential store) are out of scope;
the gateway and tool hub check their own credentials when they exist (PLAN.md §2).

- Every guarded variable that is set must have its fingerprint (`sha256:` + hex SHA-256 of the value)
  recorded under the same name in `deployment.json`. Unregistered or changed: refuse to start.
- Fingerprints are stored only in the data directory, never in the repo, and secrets are never stored.

`secretariat deployment register` records the fingerprints of the guarded variables that are set,
after loading the same `.env` files the guarded entries load. Registering is the operator's assertion
that these credentials belong to the declared environment; the guard can't verify that itself. It
requires `SECRETARIAT_DEPLOYMENT` to be set explicitly (no interactive default) and refuses if the data
directory belongs to the other environment. Entries for variables that aren't set are kept.
`secretariat deployment status` prints the declared environment, the data directory's environment and
which guarded variables are set and registered, without values.

## Failure

The process exits non-zero (desktop: an error dialog, then quit) with a message naming the variable or
file and the fix. Values and fingerprints are never printed.

## Tests

- Declared environment: valid values, invalid value, unset in headless vs interactive.
- Data directory: created on first run, mismatch refused, corrupt file refused and left untouched.
- Credentials: unregistered refused, changed refused, registered accepted, unset ignored.
- `register`: requires an explicit environment, refuses the other environment's directory, keeps entries
  for unset variables, never writes a secret.
- CLI: guarded commands refuse on mismatch; unguarded commands run without `SECRETARIAT_DEPLOYMENT`.
