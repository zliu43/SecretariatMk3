#!/usr/bin/env node
// Fails when Z.ai-family addresses appear in tracked files outside the allow-list, or when any file has
// more of them than its baseline entry. Issue #45; plan: PLAN.md §2 ("Removing Z.ai").
//
//   node scripts/secretariat/zai-address-check.mjs            check (CI)
//   node scripts/secretariat/zai-address-check.mjs --update   rewrite the baseline after removing addresses
//
// The baseline may only go down. Target: an empty baseline.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const baselinePath = resolve(repoRoot, "config/zai-address-baseline.json");

// Hosts that belong to Z.ai / Zhipu / BigModel, subdomains included. Case-insensitive, so the brand
// name "Z.ai" in UI text counts too; it goes with the services.
const ADDRESS_PATTERN =
  /(?<![a-z0-9.-])(?:[a-z0-9-]+\.)*(?:z\.ai|bigmodel\.cn|chatglm\.cn|zhipuai\.cn|zhipu\.ai)(?![a-z0-9-])/gi;

// Paths that may mention these hosts: attribution, history, tests that use them as data, and this
// check itself. Everything that ships or runs is checked.
const ALLOWED_PATHS = [
  /^NOTICE\.md$/,
  /^CLAUDE\.md$/,
  /^\.github\//,
  /^THIRD-PARTY-NOTICES\.md$/,
  /(^|\/)THIRD-PARTY-NOTICES[^/]*$/,
  /^README(\.en)?\.md$/,
  /^docs\//,
  /^specs\//,
  /^apps\/zcode-cli\/docs\//,
  /(^|\/)(test|tests|__tests__|e2e|fixtures?)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.node-test\.[cm]?[jt]s$/,
  /(^|\/)migrations\//,
  /^scripts\/secretariat\/zai-address-check\.mjs$/,
  /^config\/zai-address-baseline\.json$/,
  /^pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
];

const BINARY_EXTENSION = /\.(png|jpe?g|gif|webp|ico|icns|svg|woff2?|ttf|otf|zip|gz|tgz|mp[34]|wav|pdf|node|wasm|sqlite)$/i;

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

export function isAllowedPath(path) {
  return ALLOWED_PATHS.some((pattern) => pattern.test(path));
}

export function countAddresses(content) {
  return content.match(ADDRESS_PATTERN)?.length ?? 0;
}

function scan() {
  const counts = {};
  for (const path of trackedFiles()) {
    if (isAllowedPath(path) || BINARY_EXTENSION.test(path)) continue;
    let content;
    try {
      content = readFileSync(resolve(repoRoot, path), "utf8");
    } catch {
      continue; // deleted in the working tree
    }
    const count = countAddresses(content);
    if (count > 0) counts[path] = count;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")).files ?? {};
  } catch {
    return {};
  }
}

function total(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function main() {
  const counts = scan();
  if (process.argv.includes("--update")) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ comment: "Z.ai addresses still to remove (#1). May only go down; see scripts/secretariat/zai-address-check.mjs.", total: total(counts), files: counts }, null, 2)}\n`,
    );
    console.log(`Baseline updated: ${total(counts)} addresses in ${Object.keys(counts).length} files.`);
    return;
  }

  const baseline = readBaseline();
  const regressions = Object.entries(counts).filter(([path, count]) => count > (baseline[path] ?? 0));
  if (regressions.length > 0) {
    console.error("Z.ai addresses added outside the allow-list:");
    for (const [path, count] of regressions) {
      console.error(`  ${path}: ${count} (baseline ${baseline[path] ?? 0})`);
    }
    console.error("Remove them. Z.ai services are being removed (#1); see PLAN.md §2.");
    process.exitCode = 1;
    return;
  }
  const stale = Object.keys(baseline).filter((path) => (counts[path] ?? 0) < baseline[path]);
  console.log(`Z.ai addresses: ${total(counts)} in ${Object.keys(counts).length} files (baseline ${total(baseline)}).`);
  if (stale.length > 0) {
    console.log(`${stale.length} file(s) are below their baseline; run with --update to lower it.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
