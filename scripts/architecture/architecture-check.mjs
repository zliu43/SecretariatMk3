#!/usr/bin/env node
import {
  checkArchitecture,
  changedFilesFromGit,
  formatMarkdownReport,
  formatReport,
  generateContext,
  updateBaseline,
} from "./index.mjs";

const args = process.argv.slice(2);
const command = args[0] ?? "check";
const cwd = process.cwd();

if (command === "context") {
  const moduleId = args[1];
  if (!moduleId) throw new Error("用法: pnpm architecture:context <module-id>");
  console.log(await generateContext({ cwd, moduleId }));
  process.exit(0);
}

const baseArg = args.find((arg) => arg.startsWith("--base="));
const base = baseArg ? baseArg.slice("--base=".length) : undefined;
const changed = args.includes("--changed") || base ? await changedFilesFromGit(cwd, base) : null;
const result = await checkArchitecture({ cwd, changedFiles: changed });

if (command === "baseline:update") {
  await updateBaseline({ cwd, violations: result.violations });
  console.log(`baseline updated: ${result.violations.length} violations`);
  process.exit(0);
}

if (command === "report") {
  console.log(
    args.includes("--markdown") ? formatMarkdownReport(result) : JSON.stringify(result, null, 2),
  );
  process.exit(result.newViolations.length > 0 ? 1 : 0);
}

console.log(formatReport(result));
process.exit(result.newViolations.length > 0 ? 1 : 0);
