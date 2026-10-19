import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDeploymentGuard,
  DeploymentGuardError,
  fingerprintCredential,
  readDeploymentStatus,
  registerDeploymentCredentials,
  resolveSecretariatDataDir,
} from "../src/node/deploymentGuard.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = join(await mkdtemp(join(tmpdir(), "deployment-guard-")), ".secretariat");
});

afterEach(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

async function readRecord(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, "deployment.json"), "utf-8"));
}

async function expectGuardError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DeploymentGuardError);
  expect((error as DeploymentGuardError).code).toBe(code);
}

describe("declared environment", () => {
  it("accepts test and prod", async () => {
    for (const deployment of ["test", "prod"]) {
      const dir = join(dataDir, deployment);
      const result = await checkDeploymentGuard({
        env: { SECRETARIAT_DEPLOYMENT: deployment },
        dataDir: dir,
        interactive: false,
      });
      expect(result).toMatchObject({ deployment, source: "env", recordCreated: true });
    }
  });

  it("rejects other values", async () => {
    await expectGuardError(
      checkDeploymentGuard({
        env: { SECRETARIAT_DEPLOYMENT: "production" },
        dataDir,
        interactive: true,
      }),
      "deployment.invalid",
    );
  });

  it("is required for headless runs", async () => {
    await expectGuardError(
      checkDeploymentGuard({ env: {}, dataDir, interactive: false }),
      "deployment.missing",
    );
  });

  it("defaults interactive runs to test", async () => {
    const result = await checkDeploymentGuard({ env: {}, dataDir, interactive: true });
    expect(result).toMatchObject({ deployment: "test", source: "default" });
  });
});

describe("data directory binding", () => {
  it("records the environment on first run", async () => {
    await checkDeploymentGuard({
      env: { SECRETARIAT_DEPLOYMENT: "prod" },
      dataDir,
      interactive: false,
    });
    expect(await readRecord()).toEqual({ version: 1, deployment: "prod", credentials: {} });
  });

  it("refuses the other environment's directory", async () => {
    await checkDeploymentGuard({
      env: { SECRETARIAT_DEPLOYMENT: "prod" },
      dataDir,
      interactive: false,
    });
    await expectGuardError(
      checkDeploymentGuard({
        env: { SECRETARIAT_DEPLOYMENT: "test" },
        dataDir,
        interactive: false,
      }),
      "record.mismatch",
    );
  });

  it("refuses a corrupt record and leaves it untouched", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "deployment.json"), "{ not json");
    await expectGuardError(
      checkDeploymentGuard({
        env: { SECRETARIAT_DEPLOYMENT: "test" },
        dataDir,
        interactive: false,
      }),
      "record.unreadable",
    );
    expect(await readFile(join(dataDir, "deployment.json"), "utf-8")).toBe("{ not json");
  });
});

describe("credential binding", () => {
  const testEnv = { SECRETARIAT_DEPLOYMENT: "test", OPENROUTER_API_KEY: "sk-or-test" };

  it("refuses an unregistered credential", async () => {
    await expectGuardError(
      checkDeploymentGuard({ env: testEnv, dataDir, interactive: false }),
      "credential.unregistered",
    );
  });

  it("accepts a registered credential and ignores unset ones", async () => {
    await registerDeploymentCredentials({ env: testEnv, dataDir });
    await expect(
      checkDeploymentGuard({ env: testEnv, dataDir, interactive: false }),
    ).resolves.toMatchObject({ deployment: "test" });
  });

  it("refuses a credential that changed since registration", async () => {
    await registerDeploymentCredentials({ env: testEnv, dataDir });
    await expectGuardError(
      checkDeploymentGuard({
        env: { ...testEnv, OPENROUTER_API_KEY: "sk-or-prod" },
        dataDir,
        interactive: false,
      }),
      "credential.changed",
    );
  });

  it("never puts the secret in error messages", async () => {
    const error = await checkDeploymentGuard({ env: testEnv, dataDir, interactive: false }).catch(
      (caught: unknown) => caught as Error,
    );
    expect(error.message).not.toContain("sk-or-test");
  });
});

describe("register", () => {
  it("requires an explicit environment", async () => {
    await expectGuardError(
      registerDeploymentCredentials({ env: { OPENROUTER_API_KEY: "sk" }, dataDir }),
      "deployment.missing",
    );
  });

  it("refuses the other environment's directory", async () => {
    await registerDeploymentCredentials({ env: { SECRETARIAT_DEPLOYMENT: "prod" }, dataDir });
    await expectGuardError(
      registerDeploymentCredentials({ env: { SECRETARIAT_DEPLOYMENT: "test" }, dataDir }),
      "record.mismatch",
    );
  });

  it("keeps entries for unset variables and stores only fingerprints", async () => {
    await registerDeploymentCredentials({
      env: { SECRETARIAT_DEPLOYMENT: "test", OPENROUTER_API_KEY: "sk-or-test" },
      dataDir,
    });
    const result = await registerDeploymentCredentials({
      env: { SECRETARIAT_DEPLOYMENT: "test", BRAVE_API_KEY: "brave-test" },
      dataDir,
    });
    expect(result.registered).toEqual(["BRAVE_API_KEY"]);
    const content = await readFile(join(dataDir, "deployment.json"), "utf-8");
    expect(content).not.toContain("sk-or-test");
    expect(content).not.toContain("brave-test");
    expect(JSON.parse(content).credentials).toEqual({
      OPENROUTER_API_KEY: fingerprintCredential("sk-or-test"),
      BRAVE_API_KEY: fingerprintCredential("brave-test"),
    });
  });
});

describe("status", () => {
  it("reports set and registered credentials without values", async () => {
    await registerDeploymentCredentials({
      env: { SECRETARIAT_DEPLOYMENT: "test", OPENROUTER_API_KEY: "sk-or-test" },
      dataDir,
    });
    const status = await readDeploymentStatus({
      env: { SECRETARIAT_DEPLOYMENT: "test", OPENROUTER_API_KEY: "sk-or-other" },
      dataDir,
    });
    expect(status.recordDeployment).toBe("test");
    expect(status.credentials.find((item) => item.key === "OPENROUTER_API_KEY")).toEqual({
      key: "OPENROUTER_API_KEY",
      set: true,
      registered: true,
      matches: false,
    });
    expect(JSON.stringify(status)).not.toContain("sk-or");
  });
});

it("resolves the data directory from SECRETARIAT_DATA_BASE_DIR", () => {
  expect(resolveSecretariatDataDir({ SECRETARIAT_DATA_BASE_DIR: "/srv/data" })).toBe(
    join("/srv/data", ".secretariat"),
  );
});
