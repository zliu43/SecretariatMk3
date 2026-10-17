# Secretariat Mk3 — TODO

Open work, in rough order. Gates and targets come from [PLAN.md](PLAN.md) §4–§5; finished items move to [PROGRESS.md](PROGRESS.md).

## Now — M0 Foundation

- [x] Fork builds; `pnpm typecheck`, `pnpm lint`, unit tests pass
- [x] Rename ZCode identity/branding to Secretariat; separate data dir and app identity
- [ ] **Remove Z.ai coupling**: login/OAuth, coding plan / start plan, marketing touches, CDN plugin catalog, telemetry, remote client config
- [ ] Network audit: zero calls to Z.ai/BigModel endpoints in a 1-hour session
- [ ] `secretariat -p "hello"` answers via OpenRouter key with no login
- [ ] Brave Search MCP (`@brave/brave-search-mcp-server`) preinstalled and wired as a T0 tool
- [ ] `Dockerfile.headless`: agent + server + bots only, arm64 + amd64; ≤ 500 MB image, ≤ 300 MB idle RSS, ≤ 10 s cold start
- [ ] Container auto-restarts within 30 s; state on `/data` survives restart
- [ ] `/pause`, `/halt`, `/resume` from CLI; halt state persisted on `/data`; kills child processes (Claude Code)
- [ ] Environment guard (`SECRETARIAT_DEPLOYMENT=test|prod`): fail closed on credential/environment mismatch
- [ ] Override headless `-p` default of `yolo` (default tier cap T1)
- [ ] Verify Mac desktop app can attach to a remote server via ZCode's SSH remote workspace
- [ ] Test environment: accounts created (user), `.env.test` / `.env.prod`, fixture reset/load scripts

## Next — M1 Agent's Google account (read) + Slack + brief

- [ ] Google Workspace MCP for `zliu.secretariat@gmail.com` (read scopes first)
- [ ] Slack bot provider (Bolt, Socket Mode): DMs, slash commands, Block Kit approvals
- [ ] `/pause` and `/halt` from Slack; `/resume` from Slack requires approval
- [ ] Morning brief to Slack by 07:05 (agent inbox digest + agenda)
- [ ] Cost report per role/model
- [ ] Brave search verified on ≥ 2 model families via OpenRouter

## Later

### M2 — Tier engine + intake/triage/replies
- [ ] Tier classification for every tool (T0–T4), `--tier-cap`, `--yolo`, audit log
- [ ] Approvals over Slack with timeout → deny
- [ ] Intake (emailed requests → tasks), triage, disclosed replies, todo extraction
- [ ] Eval harness: 50-email fixture, red-team injection set (≥ 30), scorecards

### M3 — Calendar coordination + Discord
- [ ] Slot proposals, booking and invites from the agent's calendar
- [ ] Discord bot provider with command/approval parity

### M4 — Coding delegation + WhatsApp + memory
- [ ] Terminal adapter for Claude Code (subscription token, OpenRouter fallback); 20-task coding benchmark
- [ ] WhatsApp Cloud API provider (test number first, public webhook on the server)
- [ ] Persistent memory: contacts, availability, standing rules

### M5 — Dogfood
- [ ] 14-day prod run on the server; uptime and scheduling targets

## Cleanup backlog

- [ ] Redraw the TUI's "ZCODE" text-art logo
- [ ] Replace app icons (`public/logo/icons/*`, `.icns`, `.ico`)
- [ ] Linux executable/package names (`zcode`, `zcode-preview`) in `desktop-product-identity.mjs`
- [ ] Electron download mirror in `mise.toml` points at npmmirror.com; switch to default
- [ ] Rewrite `README.md` / `README.en.md` for Secretariat (keep ZCode attribution in NOTICE)
- [ ] GitHub: make `secretariat` the default branch; decide what to do with `main`
- [ ] Decide whether to keep or drop ZCode features we won't use (Feishu/Weixin bots, iOS/Android plugins, coding-plan UI)
- [ ] Machine-translate the Chinese specs in `docs/` that we'll touch
