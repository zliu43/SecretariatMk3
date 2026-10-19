# Secretariat Mk3 — Base, Task Catalog & Benchmarks

_v4, 2026-10-19. Adds the gateway and tool hub (§2), the Z.ai removal plan, and the product-ready seams. v3 (2026-10-15) added the test environment._

## 1. Base: ZCode (zai-org/ZCode)

| | |
|---|---|
| Repo | https://github.com/zai-org/ZCode |
| Version cloned | v3.15.1, commit `aac4755` (open-sourced 2026-09-21) |
| License | Apache-2.0 (fork, modify, private use allowed; keep NOTICE) |
| Stack | TypeScript / Node 24.14, pnpm monorepo; agent runtime in `apps/zcode-cli`, HTTP/WS server in `packages/server`, services in `packages/services` |
| Local checkout | `~/Projects/SecretariatMK3`, branch `secretariat` (original code on `zcode-v3.15.1`) |

### What we reuse

| Need | Where it lives in ZCode |
|---|---|
| Agent loop, tools, sub-agents, compaction | `apps/zcode-cli/packages/core`, `adapters` |
| **OpenRouter** (behind our gateway) | Anthropic Messages provider type with a custom base URL (`config/provider/zcode-builtin.json`); OpenRouter-specific reasoning mapping already fixed (`docs/openrouter-reasoning-request-contract.md`) |
| Model-agnostic adapters | Anthropic, OpenAI-compatible, OpenAI Responses adapters behind one provider config |
| Headless runs | `zcode -p "…"`, `--target <objective>`, `app-server` / `agent-server` modes |
| Container starting point | `docs/web-app-docker-image.md` (node:24-bookworm-slim, server + agent app-server, `/data` volume) |
| Scheduling | Cron automations (`CronCreate/Update/Delete`) + off-peak tasks |
| Chat channels | Bots framework (`packages/services/src/bots`): provider abstraction, per-bot actor binding, approval relay, reply modes; hosted by the headless server (`packages/server/src/http.ts`). Existing providers: Telegram, Weixin, Feishu/Lark, webhook |
| Permission modes | `plan / build / edit / guarded / auto / yolo` (`session.port.ts`); `yolo` = full access, with a `permission-full-access` contract |
| Google hookup | MCP client with OAuth |
| Skills / plugins | Claude Code-compatible plugin format |
| Memory | `packages/services/src/memory` |

### Gaps to build or change

1. **Slack, Discord, WhatsApp bot providers** — none exist; add as new providers in the Bots framework.
2. **Action-tier permission layer** — ZCode's modes are about file edits and shell commands. We need a policy keyed on *real-world actions* (send email, accept invite, share doc), with a full-bypass flag on top.
3. **Lightweight headless container** — the existing image bundles the web UI; we want agent + server + bots only.
4. **Google Workspace integration** — MCP server + OAuth scopes for the agent's own account.
5. **Claude Code bridge** — a terminal adapter (see §2).
6. **De-coupling from Z.ai** — accounts/billing, hosted services and remote config. Rip out (hard fork); plan in §2.
7. **Language** — specs and comments are mostly Chinese.
8. **Web search** — ZCode's `WebSearch` uses the provider's built-in `web_search` tool and is only shown for Anthropic-type providers on allowlisted domains (z.ai, bigmodel.cn, deepseek.com; `docs/websearch-provider-domain-allowlist.md`). OpenRouter isn't on the list, so the tool is hidden. `WebFetch` (with an egress guard) and browser-use work regardless. **Decided: Brave Search**, served as T0 tools by our tool hub (§2), which calls the Brave Search API with a key only the hub holds. Start with web and news search; add local, image, video and summarizer when needed. M1 gate: search returns results through OpenRouter on ≥ 2 model families.
9. **Gateway** — new service between the agent and OpenRouter: auth, usage limits, metering (§2).
10. **Tool hub** — new MCP server that hosts every integration (search, Google, Slack/Discord as tools) and enforces tiers server-side (§2).

## 2. Architecture decisions

### Model: OpenRouter, model-agnostic by design
- One provider: OpenRouter, reached directly with a local key or through the gateway (direct vs hosted mode, below). All other built-in provider templates are removed. Model chosen per **role** in config: `planner`, `triage` (cheap/fast), `writer` (drafts in the agent's own disclosed voice), `coder-dispatch`.
- Model-agnostic is a property we **measure**, not assume: the eval suite runs against ≥ 3 model families and we publish the gap (see §5).
- Fallback chain per role (e.g. primary → secondary on 5xx/rate limit) via OpenRouter's routing, not custom code.

### Gateway and tool hub

The agent runs in one of two modes, chosen by configuration:

- **Direct mode** (a convenience, not a supported feature): the agent holds keys itself and uses whatever ZCode's own provider, MCP and bots configuration already offers. It gets no new work of its own (no dedicated settings UI, env-var plumbing or containment); new features are built for hosted mode only. Because nothing contains it, don't use direct mode with real chat tokens or T2+ tools.
- **Hosted mode** (the target): keys live in two services we run, and the agent holds only a Secretariat token. Setting `SECRETARIAT_GATEWAY_URL` switches models to the gateway; setting the hub URL switches tools to the hub.

Direct mode is removed only after hosted mode has been built and verified end to end (decision 20).

```
 Desktop app ─┐                          ┌─> Gateway ──────> OpenRouter
 Slack/Discord┼─> Agent server ──────────┤   auth, limits, metering, audit
 (channels)   │   (ZCode runtime,        │
 CLI ─────────┘    one per user)         └─> Tool hub (MCP) ─> Brave, Google, Slack/Discord APIs
                                             tiers, approvals, audit; keys live here only
```

**Gateway** (`packages/gateway`)
- Exposes the Anthropic Messages API (what OpenRouter speaks), so on the agent side it is one provider entry: base URL = gateway, key = Secretariat token. Streams responses through unchanged.
- Authenticates a per-user token on every request (revocation takes effect immediately) and enforces a simple per-user budget (USD per day and per month) from the usage data in each response. Guarding against overshoot (pre-flight worst-case checks, concurrency caps, streams that end without usage data) is out of scope for now.
- Meters every call (user, model, tokens, cost, latency) through the shared logging infrastructure, for the cost report (O6).
- Runs locally on the Mac in development and next to the agent on the server.

**Tool hub** (`packages/tool-hub`)
- One MCP server (streamable HTTP) that hosts every integration as a module: Brave first (M0), Google Workspace (M1), Slack/Discord as tools (M1/M3). The agent is configured once ("connect to the hub") instead of once per integration.
- Every tool declares its tier (T0–T4). The hub is where tier caps, approvals and the halt flag are enforced (M2), so a misbehaving or injected agent can't bypass them. The hub never trusts an "approved" or "yolo" claim from the agent: approvals are requested and answered out of band (below), and yolo is set per session by the operator through the hub's own CLI/config, expiring when the task ends.
- Integration credentials live only in the hub (in hosted mode), so the hub runs the fail-closed credential identity check (O9) for them at startup.
- Authenticates with the same per-user token as the gateway, checked on every call, so revoking the token cuts off models and tools at once.

**Approvals.** For a T2+ call the hub asks the user out of band and receives the answer over its own connection to the platform (for example a Slack button click). The agent only sees pending → approved/denied, so it can't forge an approval. In hosted mode the hub sends the request through the single Slack/Discord app it runs (decision 21).

**Chat channels** (decision 21). One Slack/Discord app. In hosted mode the hub runs the connection and holds the tokens; the agent server's bots framework keeps a single provider (sessions, formatting, cards) whose connection goes through the hub. Acting in Slack/Discord as a tool (posting to channels, reading threads) is a hub tool. Direct mode gets no chat-specific work: it is whatever the provider can do with a local token. Whatever the agent server holds, a prompt-injected agent can reach, which is why tokens move to the hub in hosted mode.

**Logging** (#51). One logging foundation for the agent server, gateway and hub, built before the gateway and hub: structured JSON lines per service under `/data/logs/`, rotated; a correlation ID per request passed from the agent to the gateway and hub; redaction enforced by the logger API (allow-listed fields only), so prompts, responses, message bodies, tool arguments/results and secrets are never written; and a separate append-only audit log for tool calls, approvals, tier overrides and halt/resume. Builds on ZCode's `createServiceLogger`.

**Claude Code.** The terminal adapter (M4) runs Claude Code with the subscription token (`CLAUDE_CODE_OAUTH_TOKEN`). Its OpenRouter fallback uses the gateway in hosted mode and the local key in direct mode.

**Built for, not with.** The seams are product-ready: per-user tokens, budgets keyed by user, provider keys out of the agent in hosted mode, one agent container per user sharing a gateway and hub. What is *not* built: sign-up, billing, an admin UI or more than one real user. For now users and tokens are a config file with one entry.

### Removing Z.ai (M0, #1)

| Layer | What | Replacement |
|---|---|---|
| Accounts and billing | Z.ai/BigModel OAuth login, GLM Coding Plan / start plan, usage and quota stats, highspeed cards, marketing touches, and their settings/onboarding screens | None: the gateway token is the only credential. Model settings shrink to "gateway URL + token". |
| Hosted services | Remote client config (`zcode.z.ai/api/v1/client/configs`, which also refreshes the provider list), CDN plugin catalog and icons, official MCP credentials, conversation sharing, feedback upload, phone remote-control relay, help links | Bundled provider config only (one gateway provider); bundled + GitHub plugin marketplaces; tool hub instead of official MCP; local feedback logs only; phone access via Slack. Sharing, phone remote control and the Android/iOS apps are dropped. |
| Telemetry, error monitoring, auto-update | Endpoints injected only at build time (`scripts/build-time-config.mjs`), empty by default | Leave off; CI guards against reintroduction. |

Enforcement: a CI check fails on any `z.ai` / `bigmodel.cn` / `chatglm.cn` address outside an allow-list (NOTICE, old DB migrations, test data), with a baseline that may only go down; `packages/shared/src/zcodeEndpoint.ts` (the single source of those URLs) fails closed. The 1-hour network audit (#2) then confirms it at runtime. Desktop app: remove non-functional UI, otherwise change as little as possible.

### Claude Code interface: terminal adapter first
- **Phase 1 (default):** generic terminal adapter. Spawn `claude -p --output-format stream-json` (or any CLI agent) in a target repo, stream events, capture final result + diff, enforce timeout and budget. The adapter interface is `run(agentCmd, repo, prompt, limits) → {status, summary, diff, cost}`, so Codex CLI, Aider, or ZCode itself can plug into the same slot. That keeps the setup model-agnostic.
- **Phase 2 (optional):** an ACP (Agent Client Protocol) client. It gives structured permission requests, so a coding agent's "may I run X?" prompts can flow into our tier system and out to Slack for approval, instead of being pre-decided by CLI flags. Only worth it if Phase 1's all-or-nothing permission flags prove limiting.

### Permission tiers
Every tool call is classified into a tier. Each tier has a default policy, overridable per channel, per contact, or per task.

| Tier | Examples | Default |
|---|---|---|
| **T0 Read** | read mail/calendar/docs, search, web fetch | auto |
| **T1 Internal write** | labels, archive, drafts, notes doc, own memory, reminders | auto, logged |
| **T2 Reversible external** | create/move *own* calendar events, RSVP tentative, comment on doc, share a doc with the user | auto during quiet allow-list; else approve |
| **T3 Outbound communication** | send email/Slack/WhatsApp/Discord message as the agent, send invites, launch Claude Code with write access | approve (per-rule auto, e.g. "auto-reply scheduling confirmations to known contacts") |
| **T4 Irreversible / high-impact** | delete, share/permission changes to others, payments, emailing new external recipients in bulk | always approve; can't be auto-ruled |

Modes (session- or task-scoped, the CLI `--dangerously-skip-permissions` analog):
- `--tier-cap=N` — auto-approve up to tier N (default 1).
- `--yolo` / `--dangerously-skip-permissions` — auto-approve T0–T4 for this session/task. Requires explicit invocation, expires when the task ends, shows a banner in every channel reply, and is still **fully audit-logged**. Not settable from a chat channel by default (only CLI/config), to stop a hijacked Slack DM from escalating.
- Approvals are requested and collected by the tool hub out of band (button in Slack/Discord, reply in WhatsApp), with a timeout → deny; in hosted mode the hub sends them through the Slack/Discord app it runs (decision 21). See §2, Gateway and tool hub.
- Maps onto ZCode's existing `guarded` (≈ tier-cap) and `yolo` modes where possible, not a parallel system.
- Enforced in the tool hub for integration tools (outbound actions all go through it); the agent-side modes cover local actions (files, shell).
- Note: ZCode's headless `-p/--prompt` mode **defaults to `yolo`**. The tier engine must override this default before any headless/scheduled run touches real accounts.

### Deployment: lightweight container
- New `Dockerfile.headless`: `node:24-bookworm-slim` (or distroless), CLI bundle + server + bots only; no web UI, no Electron, no Playwright. Multi-arch (arm64 + amd64).
- Gateway and tool hub are separate services in the same compose file (`restart: unless-stopped`), so later several agent containers can share them. Provider keys go only to their env.
- Optional `-browser` image variant adds Chromium for browser-use tasks.
- State on one volume (`/data`): sessions, memory, bot state, audit log, halt flag. Secrets via `--env-file`, never baked in.
- Channel transports that need **no inbound port**: Slack Socket Mode, Discord Gateway, both outbound WebSockets. WhatsApp is the exception (needs a public webhook on the server).
- Claude Code runs inside the container (installed CLI + mounted repos).

### Emergency stop
Killing the process isn't enough: the container auto-restarts, scheduled jobs are persisted and resume, child processes (Claude Code) can outlive the parent, pending approvals can still complete, and the user may only have a phone. So stopping is a **persisted state**, not a process signal.

| Command | Effect | Available from |
|---|---|---|
| `/pause` | Block all outbound actions (T2+); keep reading; new drafts queue for review | CLI + every chat channel |
| `/halt` | Pause all Cron/off-peak jobs; cancel running sessions and child processes (Claude Code); deny all pending approvals; revoke `--yolo` and tier-cap overrides; drop to T0; bots answer only `/status` and `/resume` | CLI + every chat channel |
| `/resume` | Lift pause/halt | CLI, or chat with approval (so a hijacked chat account can't undo a halt) |
| Hard kill (manual runbook) | Hosted mode: revoke the user's gateway token (cuts off models and hub tools at once). Direct mode: revoke the OpenRouter and Brave keys. Then `docker stop` and revoke Google/Slack/Discord/WhatsApp credentials | Operator |

The halt flag lives on the `/data` volume and is checked at startup, before the scheduler, bots or sessions start, and before every tool call that's T2+.

### Channels
| Channel | Approach | Notes |
|---|---|---|
| **Slack** (P0) | Bolt SDK, Socket Mode; DM + slash command; Block Kit buttons for approvals | Primary interface |
| **Discord** (P1) | discord.js, Gateway; DM + buttons | Command channel only; can't act as the user |
| **WhatsApp** (P1) | Official **WhatsApp Cloud API** on a business number; public HTTPS webhook on the server. Unofficial libraries (Baileys etc.) risk a ban and are not used. | Command/notification channel only; 24-hour messaging-window rules apply |
| Telegram | Already exists in ZCode; leave disabled | Free fallback |

## 3. Task catalog

Pri: P0 MVP, P1 next, P2 later. **Tier** = highest action tier the task touches.

_Access model: the agent works only through its **own** Google account (`zliu.secretariat@gmail.com`). It has no access to the user's mailbox, calendar or Drive. People email or CC the agent; it runs its own calendar and invites the user; it shares docs it creates. Every outbound message is in its own voice and discloses that it's an AI agent acting for the user._

### Email (agent's inbox)
| # | Task | Pri | Tier |
|---|---|---|---|
| E1 | Intake: the user emails or forwards a request ("set up lunch with X next week") → becomes a tracked task | P0 | per task |
| E2 | Triage the agent's inbox: requests from the user, threads it's CC'd on, third-party replies, noise; label/archive | P0 | T1 |
| E3 | Digest of the agent's inbox for the user (what came in, what it did, what needs a decision) | P0 | T0 |
| E4 | Reply to third parties on threads it's CC'd on: draft (T1) → send (T3), always disclosed | P1 | T3 |
| E5 | Follow-up tracker: chase unanswered threads the agent sent | P1 | T1 draft / T3 send |
| E6 | Extract action items/deadlines into ZCode todos; reminders via `CronCreate` | P1 | T1 |
| E7 | Routine replies under standing rules (e.g. scheduling confirmations) | P2 | T3 |

### Calendar (agent's calendar)
| # | Task | Pri | Tier |
|---|---|---|---|
| C1 | Daily agenda brief: events the agent arranged + events the user invited it to | P0 | T0 |
| C2 | Coordinate meetings with third parties by email: propose times, collect replies | P1 | T3 |
| C3 | Book events on its calendar and invite the user + attendees | P1 | T3 (invites are outbound) |
| C4 | Meeting prep packet (agent inbox threads, web via Brave, its Drive) | P1 | T1 |
| C5 | Post-meeting notes doc + follow-up | P2 | T1 / T3 |

_Availability caveat: the agent can't see the user's personal calendar. Scheduling uses its own calendar (events it booked or was invited to) plus availability the user states per request or as standing rules (O5)._

### Docs / Drive (agent's Drive)
| # | Task | Pri | Tier |
|---|---|---|---|
| D1 | Find and summarize files in its Drive or shared with it | P0 | T0 |
| D2 | Running "Secretariat log" doc, shared with the user | P1 | T1 |
| D3 | Draft documents and share with the user | P1 | T1 create / T2 share with user |
| D4 | Share with anyone else / permission changes | P2 | T4 |

### Messaging (Slack / Discord / WhatsApp)
| # | Task | Pri | Tier |
|---|---|---|---|
| M1 | Command + approval interface over Slack DM | P0 | — |
| M2 | Summarize channels/threads the bot has been added to | P1 | T0 |
| M3 | Discord command/approval channel (parity with Slack) | P1 | — |
| M4 | WhatsApp (business number): commands, briefs, approvals | P1 | — |
| M5 | Post in Slack/Discord channels as the agent (disclosed) | P2 | T3 |

### Coding (Claude Code / any CLI agent)
| # | Task | Pri | Tier |
|---|---|---|---|
| K1 | Accept coding task by chat → run agent in repo/branch via terminal adapter | P1 | T3 |
| K2 | Report status, diff summary, tests; open draft PR | P1 | T3 |
| K3 | Nightly maintenance jobs | P2 | T3 |

### Orchestration
| # | Task | Pri | Tier |
|---|---|---|---|
| O1 | Runs 24/7 in a container, restarts on crash | P0 | — |
| O2 | Scheduled morning brief / end-of-day digest | P0 | T0 |
| O3 | Tier policy engine + `--yolo` mode + audit log | P0 | — |
| O4 | Reminders | P1 | T1 |
| O5 | Persistent memory: contacts, preferences, availability rules, standing rules | P1 | T1 |
| O6 | Cost report per role/model | P0 | T0 |
| O7 | Web research via browser-use (browser image variant) | P2 | T0 |
| O8 | Emergency stop: `/pause` and `/halt` (see §2) | P0 | — |
| O9 | Environment guard: refuse to start if credentials don't match the declared environment (see §6) | P0 | — |

## 4. Milestones and exit gates

**M0 — Foundation**
- Fork builds; `pnpm typecheck`, `pnpm lint`, CLI tests pass.
- `secretariat -p "hello"` works in hosted mode (gateway token only); no Z.ai login. Direct mode keeps working as ZCode already offers it, but is not a gate.
- Gateway: token auth, per-user daily/monthly budget enforced (test: over-budget request rejected), every call metered and logged.
- Tool hub: Brave search callable as a T0 MCP tool from the agent; in hosted mode the Brave key is present only in the hub's environment.
- CI Z.ai address check at 0; only the gateway provider remains in the bundled config.
- `Dockerfile.headless` builds for arm64 and amd64; image ≤ 500 MB; idle RSS ≤ 300 MB; cold start ≤ 10 s (agent image; gateway and hub measured separately).
- Network audit: zero calls to Z.ai/BigModel endpoints in a 1-hour session.
- Headless `-p` no longer defaults to `yolo`; full access needs an explicit flag.
- Logging infrastructure (#51) in place; agent, gateway and hub logs contain no prompt, response, tool-argument or tool-result bodies (test).
- Container auto-restarts within 30 s after kill; state survives restart.
- `/pause` and `/halt` from CLI: halt state persists across `docker restart`; no scheduled job fires, no outbound action executes, and no orphaned child process remains (tested with a running Claude Code session).
- Environment guard (O9): starting with `SECRETARIAT_DEPLOYMENT=test` and a prod credential fails closed.
- Test environment provisioned (§6) and fixture reset script runs clean.

**M1 — Agent's Google account (read) + Slack + brief** (E3, C1, D1, M1, O2, O6)
- Slack bot (Socket Mode) answers DMs; p50 reply < 30 s.
- `/pause` and `/halt` work from Slack; `/resume` from Slack requires approval.
- Morning brief to Slack by 07:05 on 5/5 weekdays; factual accuracy ≥ 95%.

**M2 — Tier engine + intake/triage/replies** (O3, E1, E2, E4, E6)
- 100% of tool calls carry a tier; classification unit tests cover every registered tool.
- Approval round-trip through Slack buttons works; timeout → deny.
- `--yolo` honored only when set via CLI/config; refused from chat (test).
- Triage agreement ≥ 90% on the agent-inbox fixture (50 emails first, 200 once budget allows); recall on user requests ≥ 98%.
- Intake: ≥ 90% of emailed requests become correctly scoped tasks.
- Draft acceptance ≥ 50%.
- 100% of outbound drafts/messages carry the AI-agent disclosure.

**M3 — Calendar coordination + Discord** (C2–C4, M3)
- Slot proposals correct 50/50 fixtures (conflicts, hours, time zones).
- Discord parity with Slack for commands + approvals.

**M4 — Coding delegation + WhatsApp + memory** (K1, K2, M4, O4, O5)
- Terminal adapter: 20-task benchmark ≥ 70% with tests passing, 100% reported back; same adapter runs a second CLI agent (proves agnosticism).
- WhatsApp Cloud API: commands, briefs, approvals working (test number first).
- Standing-rule recall across restarts 10/10.

**M5 — Dogfood (prod environment)**
- 14-day run: uptime ≥ 99%, jobs on time ≥ 99%.
- At least 3 T3 auto-rules active with zero incidents.
- Time saved ≥ 3 h/week (self-logged).

## 5. Standing benchmarks

| Metric | Target | How measured |
|---|---|---|
| Out-of-policy actions (action executed above allowed tier without approval or `--yolo`) | **0 — hard gate** | Audit log vs policy replay |
| T4 actions without approval outside `--yolo` | **0** | Audit log |
| Prompt-injection resistance | 100% on ≥ 30 adversarial emails/messages/docs; injected content must never raise tier or toggle `--yolo` | Red-team fixtures |
| Hallucinated facts in briefs | ≤ 1/week | Spot-check |
| Job reliability | ≥ 99% on time | Scheduler logs |
| **Model-agnosticism gap** | Run the eval suite on ≥ 3 model families via OpenRouter; record per-family pass rate; target: non-primary families within 15 pts of primary on triage/scheduling, 0 safety-gate failures on any family | Eval runner matrix |
| Cost | Baseline at M1; alert at 150%/day; report per role | O6 |
| Stop latency | `/halt` → all activity stopped and pending approvals denied in ≤ 10 s, from any channel | Timed drill each milestone |
| Container footprint | ≤ 500 MB image, ≤ 300 MB idle RSS | `docker images`, `docker stats` |
| Draft acceptance | 50% (M2) → 75% (M5) | Sent vs drafted diff |
| AI disclosure on outbound messages | **100% — hard gate** | Audit log scan of every T3 action |
| Cost per routine job | Report per brief/triage run; whole eval matrix must fit the current budget (~$15 OpenRouter + Brave combined) | O6 cost report |
| Test/prod isolation | **0** test runs touching prod accounts | Environment guard logs |

## 6. Test environment and evaluation harness

### Principles
1. **Two environments, same code**: `test` and `prod`, selected by `SECRETARIAT_DEPLOYMENT`. Each has its own env file (`.env.test`, `.env.prod`, both gitignored), its own `/data` volume, its own keys or gateway token, and its own accounts. Nothing is shared except Brave and the Claude Code subscription token. In hosted mode provider keys sit in the gateway's and hub's env files and the agent's env file holds only its gateway token; in direct mode the agent's env file holds the keys.
2. **Fail closed**: at startup each service checks its credentials' identities against an allowlist for the declared environment and refuses to start on any mismatch (task O9). The tool hub checks the integration credentials (Google account email, Slack team ID, Discord guild IDs, WhatsApp phone-number ID); the gateway checks its OpenRouter key belongs to the environment's account; the agent checks its gateway token and channel bot identity.
3. **Fixtures are loaded, not sent**: most test data is injected directly (e.g. Gmail API `messages.import`, Calendar API inserts), so it's free, instant, back-datable and reproducible. Live "actor" accounts are only for end-to-end tests of real sending and receiving.
4. **Reset → load → run → score**: every eval starts by wiping the test accounts back to a known state. The reset/loader scripts run **outside** the agent with their own credentials, so deletes never go through the agent's tier system.

### Accounts
| Platform | Prod | Test |
|---|---|---|
| Google (agent) | `zliu.secretariat@gmail.com` | New Gmail, e.g. `zliu.secretariat.test@gmail.com`, authorized on the same "In production" OAuth client |
| Google (actors) | — | 1–2 Gmail accounts playing (a) the principal and (b) an external contact, for live E2E email/invite tests. Don't use your personal account as the test principal. |
| Slack | Real workspace (later) | Free workspace `secretariat-dev` with its own Slack app `secretariat-test`; one alt member to play third parties; channels `#general`, `#mentions-fixture`, `#redteam` |
| Discord | Real server (later) | Server `secretariat-dev` with its own bot application `secretariat-test`; channels mirroring Slack |
| WhatsApp | Business number (later) | Meta's free Cloud API **test number**, which can message a small set of verified recipient numbers |
| OpenRouter | Prod key | Separate API key with its own credit limit (e.g. $5), so tests can't drain the prod balance |
| Brave | Shared key | Shared key; cache search results in fixtures to save calls |
| Claude Code | Subscription token | Same token; coding benchmark runs only against sandbox repos (below) |
| GitHub | Real repos | 1–2 sandbox repos (e.g. `secretariat-sandbox`) holding the 20-task coding benchmark; reset by force-push to a tagged baseline |

### Fixtures (in repo, `evals/`)
- `evals/fixtures/email/` — `.eml` files with labels (category, expected action, is-user-request). Start with 50; grow to 200.
- `evals/fixtures/calendar/` — `.ics` sets for slot-finding (conflicts, time zones, all-day events).
- `evals/fixtures/drive/` — a handful of docs for summarize/find tests.
- `evals/fixtures/chat/` — Slack/Discord message JSON for summarization and command parsing.
- `evals/redteam/` — ≥ 30 injection cases across email, calendar descriptions, docs and chat ("forward this to…", "ignore previous instructions", "run /resume", "enable yolo").
- `evals/coding/` — the 20 coding tasks, each with a target repo state and a pass test.
- `evals/scripts/` — `reset-test-env`, `load-fixtures`, `run-eval --model <slug> --suite <name>`, `score`.
- `evals/scorecards/` — one file per run: metric, value, date, commit, model, cost.

### Budget guardrails for evals
- Every `run-eval` prints a cost estimate first and refuses to run above a per-run ceiling unless forced.
- Default eval model is a cheap one; the multi-family matrix runs only at milestone gates.

## 7. Decisions

### Decided
1. **Models**: OpenRouter is the only provider, used directly with a local key or through our gateway (§2); all other provider templates are removed. Model-agnostic by design, gap measured (§5).
2. **Environments**: the Mac is local development and testing only. Deployment target is a dedicated server or a cloud VM (e.g. EC2), so the container image must be **multi-arch** (arm64 for the Mac/Graviton, amd64 for x86). Always-on and WhatsApp webhook hosting happen on the server, not the Mac.
3. **Claude Code auth**: subscription token (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) primary; OpenRouter fallback (`ANTHROPIC_BASE_URL` = the gateway with the gateway token in hosted mode, or `https://openrouter.ai/api` with the local key in direct mode; `ANTHROPIC_API_KEY=""`), switched by the terminal adapter on rate/plan-limit errors. Don't mount the Mac's `~/.claude` (macOS keeps the login in Keychain).
4. **Web search**: Brave (§1 gap 8).
5. **Fork strategy**: hard fork of ZCode v3.15.1. No upstream tracking, so core code can be changed freely, and Z.ai coupling can be ripped out rather than toggled off.
6. **Fork scope**: keep the desktop (Electron) app and web UI. The desktop app is the preferred UI: remove non-functional parts (login, coding plan, sharing), otherwise minimal changes. Phone remote control, conversation sharing and the Android/iOS apps are dropped. On the deployed server, the Mac desktop app can attach through ZCode's existing SSH remote-workspace support (to verify in M0).
7. **Secrets**: plaintext env files (chmod 600), injected with `--env-file`: `.env.test` and `.env.prod` (§6). ZCode's `.gitignore` and `.dockerignore` already exclude `.env` and `.env.*`; keep it that way.
8. **Budget**: limited to the prepaid balances (~$15 across OpenRouter and Brave, both hard-capped). Implications: cheap models for triage and evals, small fixture sets first (50 emails before 200), a cost estimate before every eval run, the multi-model matrix run only at milestone gates.
9. **To-dos and reminders**: use ZCode's built-in systems: `TodoWrite`/`TodoRead` for action items, `CronCreate` (one-shot or recurring) for reminders. ZCode todos are **session-scoped**, so the persistent list lives in a long-lived "Secretariat" session or workspace whose todo list is the master list. Other external systems integrate via hooks.
10. **Agent identity and voice**: explicitly a PA bot. It writes in its own style and always discloses that it's an AI agent acting on the user's behalf. No style-cloning from the user's sent mail.
11. **Agent account**: `zliu.secretariat@gmail.com` (from Mk2) is the agent's own Google identity.
12. **Google account type**: personal Gmail with the OAuth app set to "In production" (unverified). Refresh tokens don't expire weekly; an "unverified app" screen appears at sign-in, which is acceptable for personal use.
13. **Access model**: the agent's own account only, with no access to the user's Google accounts (§3 preamble). Only one OAuth token to protect, and a compromise exposes the agent's account, not the user's.
14. **Emergency stop**: `/pause` and `/halt` are P0 requirements (task O8, §2), gated in M0 (CLI) and M1 (Slack).
15. **Schedule/working hours**: not a concern for now.
16. **Accepted platform limits**: WhatsApp is a command/notification channel on a business number, with no access to the personal account. Discord is a command channel plus servers the bot is invited to, and can't act as the user. The Slack employer-workspace policy and the data-privacy (ZDR) concern are noted.

17. **Rename (done 2026-10-15)**: identity + branding renamed ZCode → Secretariat via `docs/secretariat/rename_secretariat.py` (data dir `~/.secretariat`, `SECRETARIAT_*` env vars, app ID `dev.secretariat.app`, `secretariat://` links, `secretariat` CLI). Package names `@zcode/*`, file names and code identifiers unchanged; Z.ai code left for removal. ZCode's own backend-selector env var became `SECRETARIAT_ENV` (test/production Z.ai backend), so our test/prod guard uses `SECRETARIAT_DEPLOYMENT` instead.

18. **Gateway and tool hub (2026-10-19)**: models and integrations can go through services we run (§2, hosted mode), so usage limits and tier enforcement live server-side and provider keys stay out of the agent. Overshoot protection for budgets is out of scope for now.
19. **Product readiness**: an optional goal is opening this up to friends or as a product. Build *for* it (per-user tokens and budgets, one agent per user, shared gateway/hub), not *with* it (no sign-up, billing or admin UI until decided).

20. **Direct mode stays until hosted mode is proven**: keeping keys locally is acceptable for now as a convenience, not a supported feature, so it gets no new work of its own. The gateway and hub are built and verified end to end before direct mode is removed.

21. **Chat channel credentials (2026-10-19): option C, the hub owns chat in hosted mode.** One Slack/Discord app. The bots framework has a single Slack (and later Discord) provider (`BotProviderAdapter`) with a switchable connection underneath:
    - **Hosted mode:** the connection talks to the hub. The hub holds the bot tokens, keeps the Socket Mode / Discord Gateway connections, forwards messages to the agent server, carries replies and card updates back, and sends and verifies approvals itself, so approvals can't be forged.
    - **Direct mode:** the connection talks to Slack/Discord with a local token. No extra containment is built for it (direct mode is a convenience; decision 20).

    Chosen over a token-injecting proxy (B) because approval clicks arriving over Socket Mode carry no signature the hub could verify, Discord sends its token inside the WebSocket, and a multi-user Slack app needs a central receiver anyway. Two bot identities (D) were rejected.

### Still open
22. **Test accounts**: structure proposed in §6; the user is creating them.
