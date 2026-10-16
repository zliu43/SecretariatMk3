export const SECRETARIAT_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "SECRETARIAT_BUILTIN_PROVIDER_CONFIG_FILE";
export const SECRETARIAT_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "SECRETARIAT_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const SECRETARIAT_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "SECRETARIAT_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly zcodeBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [SECRETARIAT_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.zcodeBuiltinFilePath,
    [SECRETARIAT_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const zcodeBuiltinFilePath = env[SECRETARIAT_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[SECRETARIAT_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!zcodeBuiltinFilePath && !personalFilePath) return null;
  if (!zcodeBuiltinFilePath || !personalFilePath) {
    throw new Error("Secretariat Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ zcodeBuiltinFilePath, personalFilePath });
}
