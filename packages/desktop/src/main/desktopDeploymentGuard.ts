import { join } from "node:path";
import {
  checkDeploymentGuard,
  DeploymentGuardError,
  SECRETARIAT_DEPLOYMENT_ENV,
  type SecretariatDeployment,
} from "@zcode/shared/node";

// Spec: docs/secretariat/specs/environment-guard.md

export interface DesktopDeploymentGuardDeps {
  env: NodeJS.ProcessEnv;
  /** Base directory that holds `.secretariat` (getDataBaseDir()). */
  dataBaseDir: string;
  showError: (title: string, message: string) => void;
  log: (message: string) => void;
}

/**
 * Runs before any host or agent process starts. On success it writes the resolved environment back
 * to `env`, so every child process inherits an explicit SECRETARIAT_DEPLOYMENT. Returns null after
 * showing the reason when startup must stop.
 */
export async function runDesktopDeploymentGuard(
  deps: DesktopDeploymentGuardDeps,
): Promise<SecretariatDeployment | null> {
  try {
    const result = await checkDeploymentGuard({
      env: deps.env,
      dataDir: join(deps.dataBaseDir, ".secretariat"),
      interactive: true,
    });
    deps.env[SECRETARIAT_DEPLOYMENT_ENV] = result.deployment;
    deps.log(
      `[deployment] ${result.deployment}${result.source === "default" ? " (SECRETARIAT_DEPLOYMENT is not set)" : ""}`,
    );
    return result.deployment;
  } catch (error) {
    if (!(error instanceof DeploymentGuardError)) throw error;
    deps.showError("Secretariat can't start", error.message);
    return null;
  }
}
