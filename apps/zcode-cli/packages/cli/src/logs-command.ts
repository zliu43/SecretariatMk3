import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunContext } from "@zcode/shared-types";
import { getDefaultLogDir } from "@zcode/adapters";
import { structuredLogDir } from "@zcode/shared/node";
import type { CliEnv } from "./env.js";

// Spec: docs/secretariat/specs/logging.md ("Reading logs")

export interface LogsCommandFlags {
  service?: string;
  audit?: boolean;
  since?: string;
  correlationId?: string;
  limit?: string;
}

const LOGS_USAGE =
  "Usage: secretariat logs [--service <agent|gateway|hub|…>] [--audit] [--since <30m|2h|7d>] [--correlation-id <id>] [--limit <n>]";
const DEFAULT_LIMIT = 200;
const DATED_FILE = /(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function parseSinceDuration(value: string): number | undefined {
  const match = /^(\d+)([mhd])$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unitMs = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
  return amount * unitMs;
}

function lineTimestamp(entry: Record<string, unknown>): number | undefined {
  const raw = typeof entry.ts === "string" ? entry.ts : entry.timestamp;
  if (typeof raw !== "string") return undefined;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? undefined : time;
}

function resolveLogDir(env: CliEnv, flags: LogsCommandFlags): string {
  if (flags.audit) return structuredLogDir(env, "audit");
  const service = flags.service ?? "agent";
  // The agent keeps ZCode's location (spec, "Where logs live").
  if (service === "agent") return env.SECRETARIAT_LOG_DIR?.trim() || getDefaultLogDir();
  return structuredLogDir(env, service);
}

export const runLogsCommand = async (
  ctx: RunContext,
  env: CliEnv,
  args: readonly string[],
  flags: LogsCommandFlags,
  now: () => Date = () => new Date(),
): Promise<number> => {
  if (args.length > 0 || (flags.audit && flags.service)) {
    ctx.stderr.write(`${LOGS_USAGE}\n`);
    return 1;
  }
  if (flags.service !== undefined && !/^[a-z][a-z0-9-]*$/.test(flags.service)) {
    ctx.stderr.write(`Invalid --service: ${flags.service}\n`);
    return 1;
  }
  const sinceMs = flags.since === undefined ? undefined : parseSinceDuration(flags.since);
  if (flags.since !== undefined && sinceMs === undefined) {
    ctx.stderr.write(`Invalid --since: ${flags.since} (use e.g. 30m, 2h or 7d)\n`);
    return 1;
  }
  const limit = flags.limit === undefined ? DEFAULT_LIMIT : Number(flags.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    ctx.stderr.write(`Invalid --limit: ${flags.limit}\n`);
    return 1;
  }

  const dir = resolveLogDir(env, flags);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => DATED_FILE.test(name)).sort();
  } catch {
    ctx.stderr.write(`No logs in ${dir}\n`);
    return 0;
  }
  const cutoff = sinceMs === undefined ? undefined : now().getTime() - sinceMs;
  if (cutoff !== undefined) {
    // A file holds one local day; keep files from the cutoff's day on.
    const cutoffDay = new Date(cutoff);
    cutoffDay.setHours(0, 0, 0, 0);
    names = names.filter((name) => {
      const day = new Date(`${DATED_FILE.exec(name)![1]}T00:00:00`);
      return day.getTime() >= cutoffDay.getTime();
    });
  }

  const matches: string[] = [];
  for (const name of names) {
    const content = await readFile(join(dir, name), "utf-8").catch(() => "");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (flags.correlationId && entry.correlationId !== flags.correlationId) continue;
      if (cutoff !== undefined && (lineTimestamp(entry) ?? 0) < cutoff) continue;
      matches.push(line);
    }
  }
  for (const line of matches.slice(-limit)) ctx.stdout.write(`${line}\n`);
  return 0;
};
