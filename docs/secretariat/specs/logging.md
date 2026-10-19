# Logging

Issue #51. Plan: PLAN.md §2 (Logging).

## Goal

One logging foundation for the agent server and for the services we add (gateway, tool hub), so that:

- every request can be followed across services by one correlation ID,
- message content and secrets never reach a log file,
- tool calls, approvals, tier overrides and halt/resume leave a durable audit trail.

## Where logs live

Under the data directory (`$SECRETARIAT_DATA_BASE_DIR/.secretariat`, home directory if unset):

```
logs/<service>/<YYYY-MM-DD>.jsonl   one file per service per local day
logs/audit/<YYYY-MM-DD>.jsonl       audit log
```

`<service>` is `gateway`, `hub`, … Files are created with mode 0600.

The agent runtime keeps ZCode's location, `.secretariat/cli/log/` (overridable with
`SECRETARIAT_LOG_DIR`), because the desktop's log export, the storage catalog and the debug tools read
it there. `secretariat logs --service agent` reads it from there.

Retention: the agent runtime keeps its existing 7-day cleanup (files `zcode-<date>.jsonl`). The new services' logs are deleted after
14 days at service startup. The audit log is never deleted automatically.

## Line format

One JSON object per line:

```json
{
  "ts": "2026-10-19T08:00:00.000Z",
  "level": "info",
  "service": "gateway",
  "event": "llm.request",
  "correlationId": "c_…",
  "model": "anthropic/claude-…",
  "inputTokens": 812,
  "durationMs": 1430
}
```

`ts`, `level`, `service`, `event` and `correlationId` (when known) are always present. Everything else is
a field passed by the caller.

## What may be logged

**New services (gateway, hub) and the audit log use the structured logger, which only writes
allow-listed fields.** A field passes if its value is:

- a number, a boolean or null; or
- a string under one of the identifier-like keys (`id` or ending in `Id`, `model`, `provider`, `tool`,
  `tier`, `status`, `outcome`, `code`, `reason`, `method`, `route`, `deployment`, `user`, `kind`), at
  most 200 characters.

Any other field is written as `"[omitted]"` (so it's visible that something was dropped, not what).
Objects and arrays are omitted. There is no way to log a free-form string, so prompts, responses,
message bodies, tool arguments/results and secrets can't be written by accident. Error details are
logged as `code` and `reason`, short values chosen by the caller in code, never text from a user or
an outside service.

**The agent runtime keeps ZCode's file logger** (`@zcode/adapters` logging), which redacts by key name.
Its key list is extended from secrets (`token`, `password`, …) to content: `prompt`, `content`, `text`,
`body`, `input`, `output`, `arguments`, `args`, `result`, `response`, `messages`, `transcript`,
`stdout`, `stderr`. Moving the agent to the allow-list logger is a later step; its current call sites
rely on free-form context.

## Correlation

- A correlation ID is created where a request enters the system (a chat message, a CLI prompt, a
  scheduled job) and carried in the `x-secretariat-correlation-id` header on calls to the gateway and
  hub, which reuse it. Shape: `c_` + 16 random hex characters.
- Inside a process it is held in async context (`runWithCorrelationId`), so loggers pick it up
  without passing it through every call.

## Audit log

Append-only: the API only appends; nothing rewrites or rotates the file except a new day starting a new
file. Events:

| `event`                                  | Fields                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `tool.call`                              | `user`, `tool`, `tier`, `outcome` (`allowed`, `denied`, `pending`, `failed`), `approvalId` |
| `approval.request` / `approval.decision` | `approvalId`, `tool`, `tier`, `outcome` (`approved`, `denied`, `timeout`)                  |
| `tier.override`                          | `user`, `kind` (`tier-cap`, `yolo`), `tier`, `status` (`set`, `cleared`, `expired`)        |
| `halt` / `pause` / `resume`              | `user`, `reason`                                                                           |

Same allow-list as service logs.

## Reading logs

`secretariat logs [--service <name>] [--audit] [--since <duration>] [--correlation-id <id>] [--limit <n>]`
prints matching lines from the newest files, oldest first. `--since` takes `30m`, `2h`, `7d`.

## Tests

- Allow-list: numbers/booleans pass, identifier keys pass, long strings and other keys become
  `[omitted]`, objects/arrays are omitted, a secret or prompt passed under any non-identifier key never
  appears in the file.
- Correlation ID from async context appears on lines; explicit ID wins; header constant.
- Files land in `logs/<service>/<date>.jsonl` with mode 0600; audit in `logs/audit/`.
- Agent redactor drops the content keys and still keeps error messages.
- `secretariat logs`: service/audit selection, `--since`, `--correlation-id`, `--limit`.
