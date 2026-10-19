import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RunContext } from "@zcode/shared-types";
import { parseSinceDuration, runLogsCommand } from "../src/logs-command.js";
import { run } from "../src/run.js";

type CapturedWriteStream = NodeJS.WriteStream & { output: () => string };

const createWriteStream = (): CapturedWriteStream => {
  let output = "";
  return {
    output: () => output,
    write: (chunk: string | Uint8Array): boolean => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    },
  } as CapturedWriteStream;
};

const createContext = (
  argv: string[] = [],
): RunContext & { stderr: CapturedWriteStream; stdout: CapturedWriteStream } => ({
  argv,
  stderr: createWriteStream(),
  stdin: { isTTY: false } as NodeJS.ReadStream,
  stdout: createWriteStream(),
});

const now = () => new Date("2026-10-19T12:00:00.000Z");

async function withLogs(
  fn: (env: Record<string, string>, base: string) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "cli-logs-"));
  try {
    const gateway = join(base, ".secretariat", "logs", "gateway");
    const audit = join(base, ".secretariat", "logs", "audit");
    await mkdir(gateway, { recursive: true });
    await mkdir(audit, { recursive: true });
    const line = (ts: string, event: string, correlationId: string) =>
      JSON.stringify({ ts, level: "info", service: "gateway", event, correlationId });
    await writeFile(
      join(gateway, "2026-10-01.jsonl"),
      `${line("2026-10-01T10:00:00.000Z", "old", "c_a")}\n`,
    );
    await writeFile(
      join(gateway, "2026-10-19.jsonl"),
      [
        line("2026-10-19T09:00:00.000Z", "morning", "c_a"),
        line("2026-10-19T11:30:00.000Z", "recent", "c_b"),
        "not json",
      ].join("\n"),
    );
    await writeFile(
      join(audit, "2026-10-19.jsonl"),
      `${JSON.stringify({ ts: "2026-10-19T11:00:00.000Z", service: "audit", event: "halt" })}\n`,
    );
    await fn({ SECRETARIAT_DATA_BASE_DIR: base }, base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const events = (output: string) =>
  output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { event: string }).event);

test("parses --since durations", () => {
  assert.equal(parseSinceDuration("30m"), 1_800_000);
  assert.equal(parseSinceDuration("2h"), 7_200_000);
  assert.equal(parseSinceDuration("7d"), 604_800_000);
  assert.equal(parseSinceDuration("2 hours"), undefined);
});

test("prints a service's lines oldest first and skips broken lines", async () => {
  await withLogs(async (env) => {
    const ctx = createContext();
    assert.equal(await runLogsCommand(ctx, env, [], { service: "gateway" }, now), 0);
    assert.deepEqual(events(ctx.stdout.output()), ["old", "morning", "recent"]);
  });
});

test("filters by --since, --correlation-id and --limit", async () => {
  await withLogs(async (env) => {
    const since = createContext();
    await runLogsCommand(since, env, [], { service: "gateway", since: "1h" }, now);
    assert.deepEqual(events(since.stdout.output()), ["recent"]);

    const correlated = createContext();
    await runLogsCommand(correlated, env, [], { service: "gateway", correlationId: "c_a" }, now);
    assert.deepEqual(events(correlated.stdout.output()), ["old", "morning"]);

    const limited = createContext();
    await runLogsCommand(limited, env, [], { service: "gateway", limit: "1" }, now);
    assert.deepEqual(events(limited.stdout.output()), ["recent"]);
  });
});

test("reads the audit log with --audit", async () => {
  await withLogs(async (env) => {
    const ctx = createContext();
    await runLogsCommand(ctx, env, [], { audit: true }, now);
    assert.deepEqual(events(ctx.stdout.output()), ["halt"]);
  });
});

test("rejects bad flags", async () => {
  await withLogs(async (env) => {
    for (const flags of [
      { since: "yesterday" },
      { limit: "0" },
      { service: "../etc" },
      { audit: true, service: "gateway" },
    ]) {
      const ctx = createContext();
      assert.equal(await runLogsCommand(ctx, env, [], flags, now), 1, JSON.stringify(flags));
    }
  });
});

test("`secretariat logs` parses its flags without the environment guard", async () => {
  await withLogs(async (env) => {
    const ctx = createContext(["logs", "--service", "gateway", "--correlation-id", "c_b"]);
    assert.equal(await run(ctx, { env }), 0);
    assert.deepEqual(events(ctx.stdout.output()), ["recent"]);
  });
});
