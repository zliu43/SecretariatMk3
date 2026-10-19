import type { RunContext } from "@zcode/shared-types";
import {
  checkDeploymentGuard,
  DeploymentGuardError,
  readDeploymentStatus,
  registerDeploymentCredentials,
  resolveSecretariatDataDir,
} from "@zcode/shared/node";
import type { CliEnv } from "./env.js";

// Spec: docs/secretariat/specs/environment-guard.md

export type CliDeploymentGuard = (options: {
  env: CliEnv;
  interactive: boolean;
}) => Promise<{ deployment: string; source: "env" | "default" }>;

const defaultDeploymentGuard: CliDeploymentGuard = async ({ env, interactive }) =>
  await checkDeploymentGuard({ env, dataDir: resolveSecretariatDataDir(env), interactive });

/**
 * Runs the environment guard for an entry that starts the agent. Call it after the entry has loaded
 * its .env files, so credentials from those files are checked too. Returns false after writing the
 * reason to stderr.
 */
export const enforceDeploymentGuard = async (
  ctx: RunContext,
  env: CliEnv,
  interactive: boolean,
  guard: CliDeploymentGuard = defaultDeploymentGuard,
): Promise<boolean> => {
  try {
    const result = await guard({ env, interactive });
    if (result.source === "default") {
      ctx.stderr.write(`Environment: ${result.deployment} (SECRETARIAT_DEPLOYMENT is not set)\n`);
    }
    return true;
  } catch (error) {
    if (!(error instanceof DeploymentGuardError)) throw error;
    ctx.stderr.write(`Environment guard: ${error.message}\n`);
    return false;
  }
};

const DEPLOYMENT_COMMAND_USAGE = "Usage: secretariat deployment [status|register]";

export const runDeploymentCommand = async (
  ctx: RunContext,
  env: CliEnv,
  args: readonly string[],
): Promise<number> => {
  const dataDir = resolveSecretariatDataDir(env);
  const [subcommand = "status", ...rest] = args;
  if (rest.length > 0) {
    ctx.stderr.write(`${DEPLOYMENT_COMMAND_USAGE}\n`);
    return 1;
  }
  try {
    if (subcommand === "register") {
      const result = await registerDeploymentCredentials({ env, dataDir });
      ctx.stdout.write(
        result.registered.length > 0
          ? `Registered ${result.registered.join(", ")} for the ${result.deployment} deployment in ${result.recordPath}\n`
          : `No guarded credentials are set; ${result.recordPath} is bound to ${result.deployment}.\n`,
      );
      return 0;
    }
    if (subcommand === "status") {
      const status = await readDeploymentStatus({ env, dataDir });
      ctx.stdout.write(`declared: ${status.declared ?? "unset"}\n`);
      ctx.stdout.write(`data directory: ${status.recordDeployment ?? "unbound"} (${status.recordPath})\n`);
      for (const item of status.credentials) {
        const state = !item.set
          ? "not set"
          : !item.registered
            ? "set, not registered"
            : item.matches
              ? "set, registered"
              : "set, differs from registered";
        ctx.stdout.write(`${item.key}: ${state}\n`);
      }
      return 0;
    }
  } catch (error) {
    if (!(error instanceof DeploymentGuardError)) throw error;
    ctx.stderr.write(`Environment guard: ${error.message}\n`);
    return 1;
  }
  ctx.stderr.write(`${DEPLOYMENT_COMMAND_USAGE}\n`);
  return 1;
};
