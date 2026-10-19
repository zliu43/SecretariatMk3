import assert from "node:assert/strict";
import test from "node:test";
import { countAddresses, isAllowedPath } from "./zai-address-check.mjs";

test("counts Z.ai-family hosts, including subdomains, and nothing else", () => {
  assert.equal(countAddresses("https://zcode.z.ai/api and chat.z.ai"), 2);
  assert.equal(countAddresses("open.bigmodel.cn:443 z-cdn.chatglm.cn"), 2);
  assert.equal(countAddresses("https://biz.ai quiz.aim zai-removed.invalid"), 0);
});

test("allows attribution, docs, tests and migrations; checks shipped code", () => {
  for (const path of [
    "NOTICE.md",
    "docs/foo.md",
    "packages/shared/test/zcodeEndpoint.test.ts",
    "apps/zcode-cli/packages/adapters/src/storage/session-store/migrations/0020-x.ts",
  ]) {
    assert.equal(isAllowedPath(path), true, path);
  }
  for (const path of [
    "packages/shared/src/zcodeEndpoint.ts",
    "config/provider/zcode-builtin.json",
    ".env.production",
    "apps/zcode-cli/packages/pdf-plugin/skills/pdf/briefs/report.md",
    "packages/x/src/test/helper.ts",
    "packages/x/src/fixtures/data.json",
  ]) {
    assert.equal(isAllowedPath(path), false, path);
  }
});

test("runs the check when invoked through a path with spaces or a symlink", async () => {
  const { mkdtemp, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "zai check "));
  try {
    const link = join(dir, "check link.mjs");
    await symlink(new URL("./zai-address-check.mjs", import.meta.url).pathname, link);
    const output = execFileSync(process.execPath, [link], { encoding: "utf8" });
    assert.match(output, /Z\.ai addresses: \d+ in \d+ files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

