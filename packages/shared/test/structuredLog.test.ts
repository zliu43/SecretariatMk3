import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupStructuredLogs,
  CORRELATION_ID_HEADER,
  createAuditLog,
  createStructuredLogger,
  newCorrelationId,
  runWithCorrelationId,
  sanitizeLogFields,
  structuredLogDir,
} from "../src/node/structuredLog.js";

let dir: string;
const now = () => new Date(2026, 9, 19, 9, 30);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "structured-log-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readLines(subdir = dir): Promise<Record<string, unknown>[]> {
  const content = await readFile(join(subdir, "2026-10-19.jsonl"), "utf-8");
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("allow-list", () => {
  it("keeps numbers, booleans, null and identifier strings", () => {
    expect(
      sanitizeLogFields({
        inputTokens: 812,
        cached: false,
        cost: null,
        model: "anthropic/claude-x",
        approvalId: "ap_1",
        id: "x",
      }),
    ).toEqual({
      inputTokens: 812,
      cached: false,
      cost: null,
      model: "anthropic/claude-x",
      approvalId: "ap_1",
      id: "x",
    });
  });

  it("omits free-form strings, long identifiers, objects and arrays", () => {
    expect(
      sanitizeLogFields({
        prompt: "please forward my email",
        apiKey: "sk-secret",
        model: "m".repeat(201),
        args: { to: "a@b.c" },
        list: [1, 2],
        ratio: Number.NaN,
      }),
    ).toEqual({
      prompt: "[omitted]",
      apiKey: "[omitted]",
      model: "[omitted]",
      args: "[omitted]",
      list: "[omitted]",
      ratio: null,
    });
  });

  it("never lets fields overwrite the line's own keys", () => {
    expect(sanitizeLogFields({ event: "x", service: "y", level: "z", ts: 1 })).toEqual({});
  });
});

describe("structured logger", () => {
  it("writes JSON lines per day with mode 0600 and no content", async () => {
    const logger = createStructuredLogger({ dir, name: "gateway", now });
    await logger.info("llm.request", { model: "m1", inputTokens: 5, prompt: "secret prompt" });
    const [line] = await readLines();
    expect(line).toEqual({
      ts: now().toISOString(),
      level: "info",
      service: "gateway",
      event: "llm.request",
      model: "m1",
      inputTokens: 5,
      prompt: "[omitted]",
    });
    expect((await readFile(join(dir, "2026-10-19.jsonl"), "utf-8")).includes("secret prompt")).toBe(
      false,
    );
    expect((await stat(join(dir, "2026-10-19.jsonl"))).mode & 0o777).toBe(0o600);
  });

  it("drops lines below the minimum level", async () => {
    const logger = createStructuredLogger({ dir, name: "hub", now, minLevel: "warn" });
    await logger.info("ignored");
    await logger.warn("kept");
    expect((await readLines()).map((line) => line.event)).toEqual(["kept"]);
  });

  it("takes the correlation ID from async context, and an explicit one wins", async () => {
    const logger = createStructuredLogger({ dir, name: "hub", now });
    await runWithCorrelationId("c_context", async () => {
      await logger.info("a");
      await logger.withCorrelationId("c_explicit").info("b");
    });
    await logger.info("c");
    expect((await readLines()).map((line) => line.correlationId)).toEqual([
      "c_context",
      "c_explicit",
      undefined,
    ]);
  });

  it("creates correlation IDs of the documented shape", () => {
    expect(newCorrelationId()).toMatch(/^c_[0-9a-f]{16}$/);
    expect(CORRELATION_ID_HEADER).toBe("x-secretariat-correlation-id");
  });
});

describe("audit log", () => {
  it("appends events with the same allow-list", async () => {
    const audit = createAuditLog({ dir, now });
    await audit.append({
      event: "tool.call",
      user: "u1",
      tool: "gmail.send",
      tier: "T3",
      outcome: "pending",
    });
    await audit.append({ event: "halt", user: "u1", reason: "slack" });
    const lines = await readLines();
    expect(lines.map((line) => [line.service, line.event, line.outcome ?? line.reason])).toEqual([
      ["audit", "tool.call", "pending"],
      ["audit", "halt", "slack"],
    ]);
  });
});

describe("retention", () => {
  it("removes only dated files older than the retention period", async () => {
    await mkdir(dir, { recursive: true });
    for (const name of ["2026-09-01.jsonl", "2026-10-10.jsonl", "notes.txt"]) {
      await writeFile(join(dir, name), "");
    }
    const removed = await cleanupStructuredLogs({ dir, retentionDays: 14, now: now() });
    expect(removed).toEqual(["2026-09-01.jsonl"]);
    expect((await readdir(dir)).sort()).toEqual(["2026-10-10.jsonl", "notes.txt"]);
  });
});

it("puts service logs under the data directory", () => {
  expect(structuredLogDir({ SECRETARIAT_DATA_BASE_DIR: "/srv" }, "gateway")).toBe(
    join("/srv", ".secretariat", "logs", "gateway"),
  );
});
