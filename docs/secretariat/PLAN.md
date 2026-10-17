# Secretariat Mk3 — Base, Task Catalog & Benchmarks

_v3, 2026-10-15. Adds test-environment structure; Google account type decided._

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
| **OpenRouter** | Built-in `openrouter` provider template (`config/provider/zcode-builtin.json`), speaks Anthropic Messages API; OpenRouter-specific reasoning mapping already fixed (`docs/openrouter-reasoning-request-contract.md`) |
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
6. **De-coupling from Z.ai** — login/coding-plan gating, CDN plugin catalog, telemetry. Rip out (hard fork).
7. **Language** — specs and comments are mostly Chinese.
8. **Web search** — ZCode's `WebSearch` uses the provider's built-in `web_search` tool and is only shown for Anthropic-type providers on allowlisted domains (z.ai, bigmodel.cn, deepseek.com; `docs/websearch-provider-domain-allowlist.md`). OpenRouter isn't on the list, so the tool is hidden. `WebFetch` (with an egress guard) and browser-use work regardless. **Decided: Brave Search** via the official MCP server `@brave/brave-search-mcp-server` (stdio, `BRAVE_API_KEY` passed as a runtime secret). Tools: `brave_web_search`, `brave_news_search`, `brave_local_search`, `brave_image_search`, `brave_video_search`, `brave_summarizer`. Tier T0 (read). In the container, preinstall the package rather than calling `npx` at runtime. M1 gate: search returns results through OpenRouter on ≥ 2 model families.

## 2. Architecture decisions

### Model: OpenRouter, model-agnostic by design
- One provider (OpenRouter), model chosen per **role** in config: `planner`, `triage` (cheap/fast), `writer` (drafts in the agent's own disclosed voice), `coder-dispatch`.
- Model-agnostic is a property we **measure**, not assume: the eval suite runs against ≥ 3 model families and we publish the gap (see §5).
- Fallback chain per role (e.g. primary → secondary on 5xx/rate limit) via OpenRouter's routing, not custom code.

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
- Approvals flow over the chat channel (button in Slack/Discord, reply in WhatsApp) with a timeout → deny.
- Maps onto ZCode's existing `guarded` (≈ tier-cap) and `yolo` modes where possible, not a parallel system.
- Note: ZCode's headless `-p/--prompt` mode **defaults to `yolo`**. The tier engine must override this default before any headless/scheduled run touches real accounts.

### Deployment: lightweight container
- New `Dockerfile.headless`: `node:24-bookworm-slim` (or distroless), CLI bundle + server + bots only; no web UI, no Electron, no Playwright. Multi-arch (arm64 + amd64).
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
| Hard kill (manual runbook) | `docker stop` + revoke Google/Slack/Discord/WhatsApp/OpenRouter/Brave tokens | Operator |

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
- `zcode -p "hello"` works via OpenRouter key, no Z.ai login.
- `Dockerfile.headless` builds for arm64 and amd64; image ≤ 500 MB; idle RSS ≤ 300 MB; cold start ≤ 10 s.
- Network audit: zero calls to Z.ai/BigModel endpoints in a 1-hour session.
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
1. **Two environments, same code**: `test` and `prod`, selected by `SECRETARIAT_DEPLOYMENT`. Each has its own env file (`.env.test`, `.env.prod`, both gitignored), its own `/data` volume, and its own accounts. Nothing is shared except Brave and the Claude Code subscription token.
2. **Fail closed**: at startup the agent checks every credential's identity (Google account email, Slack team ID, Discord guild IDs, WhatsApp phone-number ID) against an allowlist for the declared environment and refuses to start on any mismatch (task O9).
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
1. **Models**: OpenRouter for everything; model-agnostic by design, gap measured (§5).
2. **Environments**: the Mac is local development and testing only. Deployment target is a dedicated server or a cloud VM (e.g. EC2), so the container image must be **multi-arch** (arm64 for the Mac/Graviton, amd64 for x86). Always-on and WhatsApp webhook hosting happen on the server, not the Mac.
3. **Claude Code auth**: subscription token (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) primary; OpenRouter fallback (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=""`), switched by the terminal adapter on rate/plan-limit errors. Don't mount the Mac's `~/.claude` (macOS keeps the login in Keychain).
4. **Web search**: Brave (§1 gap 8).
5. **Fork strategy**: hard fork of ZCode v3.15.1. No upstream tracking, so core code can be changed freely, and Z.ai coupling can be ripped out rather than toggled off.
6. **Fork scope**: keep the desktop (Electron) app and web UI. The desktop app is the preferred UI. On the deployed server, the Mac desktop app can attach through ZCode's existing SSH remote-workspace support (to verify in M0).
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

### Still open
18. **Test accounts**: structure proposed in §6; the user is creating them.
