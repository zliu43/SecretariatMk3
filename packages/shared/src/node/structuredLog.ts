import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveSecretariatDataDir } from "./deploymentGuard.js";

// Spec: docs/secretariat/specs/logging.md

export const CORRELATION_ID_HEADER = "x-secretariat-correlation-id";
export const STRUCTURED_LOG_RETENTION_DAYS = 14;
export const OMITTED_FIELD = "[omitted]";
const MAX_IDENTIFIER_LENGTH = 200;
/** Identifier shape: no whitespace, so sentences, subjects and error messages don't pass. */
const IDENTIFIER_VALUE = /^[\w.:@/+-]+$/;

/** String fields are only written under these identifier-like keys (plus `id` / `…Id`). */
const IDENTIFIER_KEYS = new Set([
  "model",
  "provider",
  "tool",
  "tier",
  "status",
  "outcome",
  "code",
  "reason",
  "method",
  "route",
  "deployment",
  "user",
  "kind",
]);
const RESERVED_KEYS = new Set(["ts", "level", "service", "event", "correlationId"]);

export type LogLevelName = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

type Env = Record<string, string | undefined>;

const correlationStorage = new AsyncLocalStorage<string>();

export function newCorrelationId(): string {
  return `c_${randomBytes(8).toString("hex")}`;
}

/** Runs `fn` with `id` as the current correlation ID for every log line written inside it. */
export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return correlationStorage.run(id, fn);
}

export function currentCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

function isIdentifierKey(key: string): boolean {
  return key === "id" || key.endsWith("Id") || IDENTIFIER_KEYS.has(key);
}

/** Applies the allow-list: anything that could carry content becomes `[omitted]`. */
export function sanitizeLogFields(fields: LogFields): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_KEYS.has(key) || value === undefined) continue;
    if (value === null || typeof value === "boolean") {
      sanitized[key] = value;
    } else if (typeof value === "number") {
      sanitized[key] = Number.isFinite(value) ? value : null;
    } else if (
      typeof value === "string" &&
      isIdentifierKey(key) &&
      value.length <= MAX_IDENTIFIER_LENGTH &&
      IDENTIFIER_VALUE.test(value)
    ) {
      sanitized[key] = value;
    } else {
      sanitized[key] = OMITTED_FIELD;
    }
  }
  return sanitized;
}

export function formatLocalLogDate(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function structuredLogDir(env: Env, name: string): string {
  return join(resolveSecretariatDataDir(env), "logs", name);
}

interface LogWriterOptions {
  dir: string;
  name: string;
  now?: () => Date;
}

async function appendLine(
  options: LogWriterOptions,
  level: LogLevelName,
  event: string,
  fields: LogFields,
  correlationId: string | undefined,
  failure: "ignore" | "throw" = "ignore",
): Promise<void> {
  const now = (options.now ?? (() => new Date()))();
  const line = {
    ts: now.toISOString(),
    level,
    service: options.name,
    event,
    ...(correlationId ? { correlationId } : {}),
    ...sanitizeLogFields(fields),
  };
  try {
    await mkdir(options.dir, { recursive: true, mode: 0o700 });
    await appendFile(
      join(options.dir, `${formatLocalLogDate(now)}.jsonl`),
      `${JSON.stringify(line)}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );
  } catch (error) {
    // Diagnostic logging must never break the request path; the audit log must not fail silently.
    if (failure === "throw") throw error;
  }
}

export interface StructuredLogger {
  debug(event: string, fields?: LogFields): Promise<void>;
  info(event: string, fields?: LogFields): Promise<void>;
  warn(event: string, fields?: LogFields): Promise<void>;
  error(event: string, fields?: LogFields): Promise<void>;
  /** Same logger with a fixed correlation ID (overrides the async context). */
  withCorrelationId(id: string): StructuredLogger;
}

export function createStructuredLogger(
  options: LogWriterOptions & { minLevel?: LogLevelName; correlationId?: string },
): StructuredLogger {
  const order: Record<LogLevelName, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = order[options.minLevel ?? "info"];
  const write =
    (level: LogLevelName) =>
    async (event: string, fields: LogFields = {}) => {
      if (order[level] < minLevel) return;
      await appendLine(
        options,
        level,
        event,
        fields,
        options.correlationId ?? currentCorrelationId(),
      );
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    withCorrelationId: (id) => createStructuredLogger({ ...options, correlationId: id }),
  };
}

export type AuditEvent =
  | {
      event: "tool.call";
      user: string;
      tool: string;
      tier: string;
      outcome: "allowed" | "denied" | "pending" | "failed";
      approvalId?: string;
    }
  | {
      event: "approval.request" | "approval.decision";
      approvalId: string;
      tool: string;
      tier: string;
      outcome?: "approved" | "denied" | "timeout";
    }
  | {
      event: "tier.override";
      user: string;
      kind: "tier-cap" | "yolo";
      tier?: string;
      status: "set" | "cleared" | "expired";
    }
  | { event: "halt" | "pause" | "resume"; user: string; reason?: string };

export interface AuditLog {
  /**
   * Appends one event; there is no API to change or remove past events. Rejects when the event
   * couldn't be written, so callers can fail closed instead of acting unrecorded.
   */
  append(event: AuditEvent): Promise<void>;
}

export function createAuditLog(options: { dir: string; now?: () => Date }): AuditLog {
  return {
    append: async ({ event, ...fields }) => {
      await appendLine(
        { dir: options.dir, name: "audit", now: options.now },
        "info",
        event,
        fields,
        currentCorrelationId(),
        "throw",
      );
    },
  };
}

/** Deletes `<date>.jsonl` files older than the retention period. Refuses the audit log directory. */
export async function cleanupStructuredLogs(options: {
  dir: string;
  retentionDays?: number;
  now?: Date;
}): Promise<string[]> {
  if (basename(options.dir) === "audit") {
    throw new Error("The audit log is never cleaned up.");
  }
  const retentionDays = options.retentionDays ?? STRUCTURED_LOG_RETENTION_DAYS;
  const cutoff = new Date(options.now ?? new Date());
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffName = `${formatLocalLogDate(cutoff)}.jsonl`;
  let names: string[];
  try {
    names = await readdir(options.dir);
  } catch {
    return [];
  }
  const removed = names.filter(
    (name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name < cutoffName,
  );
  await Promise.all(removed.map((name) => rm(join(options.dir, name), { force: true })));
  return removed;
}
