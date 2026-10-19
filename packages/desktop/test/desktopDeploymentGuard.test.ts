import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDesktopDeploymentGuard } from "../src/main/desktopDeploymentGuard.js";

let dataBaseDir: string;

beforeEach(async () => {
  dataBaseDir = await mkdtemp(join(tmpdir(), "desktop-deployment-guard-"));
});

afterEach(async () => {
  await rm(dataBaseDir, { recursive: true, force: true });
});

describe("desktop deployment guard", () => {
  it("defaults to test and passes the resolved value on to child processes", async () => {
    const env: NodeJS.ProcessEnv = {};
    const showError = vi.fn();
    await expect(
      runDesktopDeploymentGuard({ env, dataBaseDir, showError, log: vi.fn() }),
    ).resolves.toBe("test");
    expect(env.SECRETARIAT_DEPLOYMENT).toBe("test");
    expect(showError).not.toHaveBeenCalled();
  });

  it("shows the reason and stops on a mismatch", async () => {
    await runDesktopDeploymentGuard({
      env: { SECRETARIAT_DEPLOYMENT: "prod" },
      dataBaseDir,
      showError: vi.fn(),
      log: vi.fn(),
    });
    const showError = vi.fn();
    await expect(
      runDesktopDeploymentGuard({
        env: { SECRETARIAT_DEPLOYMENT: "test" },
        dataBaseDir,
        showError,
      }),
    ).resolves.toBeNull();
    expect(showError).toHaveBeenCalledWith(
      "Secretariat can't start",
      expect.stringContaining("belongs to the prod deployment"),
    );
  });

  it("refuses an unregistered credential", async () => {
    const showError = vi.fn();
    await expect(
      runDesktopDeploymentGuard({
        env: { OPENROUTER_API_KEY: "sk-or-unregistered" },
        dataBaseDir,
        showError,
        log: vi.fn(),
      }),
    ).resolves.toBeNull();
    expect(showError.mock.calls[0]?.[1]).toContain("OPENROUTER_API_KEY is not registered");
    expect(showError.mock.calls[0]?.[1]).not.toContain("sk-or-unregistered");
  });
});
