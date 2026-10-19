import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RunContext } from "@zcode/shared-types";
import { DeploymentGuardError } from "@zcode/shared/node";
import { run } from "../src/run.js";
import type { RunDependencies } from "../src/run.js";

type CapturedWriteStream = NodeJS.WriteStream & { output: () => string };

const createWriteStream = (): CapturedWriteStream => {
  let output = "";
  return {
    output: () => output,
    write: (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      output += typeof chunk === "string" ? chunk : chunk.toString();
      const callback = rest.find((item) => typeof item === "function") as (() => void) | undefined;
      callback?.();
      return true;
    },
  } as CapturedWriteStream;
};

const createContext = (
  argv: string[],
): RunContext & { stderr: CapturedWriteStream; stdout: CapturedWriteStream } => ({
  argv,
  stderr: createWriteStream(),
  stdin: { isTTY: false } as NodeJS.ReadStream,
  stdout: createWriteStream(),
});

const refusingGuard: RunDependencies["deploymentGuard"] = async () => {
  throw new DeploymentGuardError("record.mismatch", "data directory belongs to prod");
};

const failIfStarted = (): never => {
  throw new Error("the agent must not start when the guard refuses");
};

test("headless prompt refuses to start when the guard refuses", async () => {
  const ctx = createContext(["--prompt", "hello"]);
  const exitCode = await run(ctx, {
    deploymentGuard: refusingGuard,
    loadDotenv: () => ({ keys: [], loaded: false }),
    createZCodeApp: failIfStarted,
  });
  assert.equal(exitCode, 1);
  assert.match(ctx.stderr.output(), /Environment guard: data directory belongs to prod/);
});

test("app-server refuses to start when the guard refuses", async () => {
  const ctx = createContext(["app-server", "--stdio"]);
  const exitCode = await run(ctx, {
    deploymentGuard: refusingGuard,
    loadDotenv: () => ({ keys: [], loaded: false }),
    runZCodeProtocolAgent: failIfStarted,
  });
  assert.equal(exitCode, 1);
  assert.match(ctx.stderr.output(), /Environment guard:/);
});

test("headless entries are checked as non-interactive", async () => {
  let interactive: boolean | undefined;
  const ctx = createContext(["app-server", "--stdio"]);
  await run(ctx, {
    deploymentGuard: async (options) => {
      interactive = options.interactive;
      throw new DeploymentGuardError("deployment.missing", "missing");
    },
    loadDotenv: () => ({ keys: [], loaded: false }),
    runZCodeProtocolAgent: failIfStarted,
  });
  assert.equal(interactive, false);
});

test("unguarded commands run without SECRETARIAT_DEPLOYMENT", async () => {
  const ctx = createContext(["version"]);
  const exitCode = await run(ctx, { env: {}, deploymentGuard: refusingGuard });
  assert.equal(exitCode, 0);
});

test("deployment register and status use fingerprints only", async () => {
  const base = await mkdtemp(join(tmpdir(), "cli-deployment-"));
  try {
    const env = {
      SECRETARIAT_DATA_BASE_DIR: base,
      SECRETARIAT_DEPLOYMENT: "test",
      OPENROUTER_API_KEY: "sk-or-secret-value",
    };
    const register = createContext(["deployment", "register"]);
    assert.equal(await run(register, { env }), 0);
    assert.match(register.stdout.output(), /Registered OPENROUTER_API_KEY for the test deployment/);

    const record = await readFile(join(base, ".secretariat", "deployment.json"), "utf-8");
    assert.doesNotMatch(record, /sk-or-secret-value/);

    const status = createContext(["deployment", "status"]);
    assert.equal(await run(status, { env }), 0);
    assert.match(status.stdout.output(), /OPENROUTER_API_KEY: set, registered/);
    assert.doesNotMatch(status.stdout.output(), /sk-or-secret-value|sha256:/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("deployment register sees credentials from .env", async () => {
  const base = await mkdtemp(join(tmpdir(), "cli-deployment-"));
  try {
    const env: Record<string, string | undefined> = {
      SECRETARIAT_DATA_BASE_DIR: base,
      SECRETARIAT_DEPLOYMENT: "test",
    };
    const ctx = createContext(["deployment", "register"]);
    const exitCode = await run(ctx, {
      env,
      loadDotenv: (options) => {
        if (options?.env) options.env.OPENROUTER_API_KEY = "sk-or-from-dotenv";
        return { keys: ["OPENROUTER_API_KEY"], loaded: true, path: "/workspace/.env" };
      },
    });
    assert.equal(exitCode, 0);
    assert.match(ctx.stdout.output(), /Registered OPENROUTER_API_KEY/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("deployment register requires an explicit environment", async () => {
  const base = await mkdtemp(join(tmpdir(), "cli-deployment-"));
  try {
    const ctx = createContext(["deployment", "register"]);
    assert.equal(await run(ctx, { env: { SECRETARIAT_DATA_BASE_DIR: base } }), 1);
    assert.match(ctx.stderr.output(), /Set SECRETARIAT_DEPLOYMENT/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
