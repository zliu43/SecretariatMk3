/**
 * Node-only shared utilities.
 *
 * This subpath must not be imported by renderer/browser bundles.
 */
export { acquireFileLock } from "./node/atomicFileLock.js";
export { createNodeNetworkCapture, withoutNetworkCapture } from "./node/networkCapture.js";
export {
  GEN_UI_OUTPUT_ROOT_ENV,
  GEN_UI_OUTPUT_DIRECTORY,
  getGenUiOutputDirectory,
} from "./node/genUiPaths.js";
export { scanOfficialPluginCacheRoots } from "./node/officialPluginCache.js";
export {
  migrateUserSubagentMarkdown,
  migrateSubagentStateFile,
} from "./node/subagentMarkdownMigration.js";
export {
  atomicWritePrivateTextFile,
  backupCorruptFile,
  withFileLock,
  type SharedFileLockOptions,
} from "./node/privateFilePersistence.js";
export {
  createNodeSelfResourceSampler,
  NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS,
  type NodeSelfResourceSampler,
  type NodeSelfResourceSamplerOptions,
} from "./node/nodeSelfResourceTelemetry.js";
export {
  checkDeploymentGuard,
  DEPLOYMENT_RECORD_FILE_NAME,
  DeploymentGuardError,
  fingerprintCredential,
  GUARDED_CREDENTIAL_ENV_KEYS,
  readDeploymentStatus,
  registerDeploymentCredentials,
  resolveSecretariatDataDir,
  SECRETARIAT_DEPLOYMENT_ENV,
  type DeploymentGuardErrorCode,
  type DeploymentGuardOptions,
  type DeploymentGuardResult,
  type DeploymentRegisterResult,
  type DeploymentStatus,
  type SecretariatDeployment,
} from "./node/deploymentGuard.js";
