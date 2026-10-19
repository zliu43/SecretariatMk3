import type { RunDependencies } from "../../src/run.js";

/** For tests that pass their own `env` and aren't about the environment guard. */
export const allowDeploymentGuard: NonNullable<RunDependencies["deploymentGuard"]> = async () => ({
  deployment: "test",
  source: "env",
});
