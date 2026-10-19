// Preloaded by the package's test script (`--import ./tests/support/deployment-env.mjs`).
// Entries that start the agent run the environment guard (docs/secretariat/specs/environment-guard.md).
// Give test processes a test deployment with a throwaway data directory, and drop real credentials,
// so tests never bind or read the developer's own data directory.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SECRETARIAT_DEPLOYMENT = "test";
process.env.SECRETARIAT_DATA_BASE_DIR ??= mkdtempSync(join(tmpdir(), "secretariat-cli-tests-"));
for (const key of ["OPENROUTER_API_KEY", "BRAVE_API_KEY", "SECRETARIAT_GATEWAY_TOKEN"]) {
  delete process.env[key];
}
