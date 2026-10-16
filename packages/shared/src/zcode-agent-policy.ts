import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { ZCodeProvider } from "./zcode-task-types-core.js";

export const SECRETARIAT_AGENT_PROVIDER = "glm" satisfies ZCodeProvider;
export const SECRETARIAT_AGENT_PROVIDER_LABEL = "Secretariat Agent";
export const SECRETARIAT_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

/**
 * 解析持久化/relay 数据时的 provider 归一 schema：
 * 已移除的第三方 provider 历史值仅作为归一化输入保留，统一收敛为 glm；
 * 其它非法值保持拒绝，与收窄前的校验边界一致。
 */
export const legacyZCodeProviderSchema = z
  .enum(["claude", "opencode", "gemini", "codex", "glm"])
  .transform((): typeof SECRETARIAT_AGENT_PROVIDER => SECRETARIAT_AGENT_PROVIDER);

export const SECRETARIAT_ENABLED_AGENT_PROVIDERS = [
  SECRETARIAT_AGENT_PROVIDER,
] as const satisfies readonly ZCodeProvider[];

export const SECRETARIAT_COMMAND_AGENT_SOURCES = [
  SECRETARIAT_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToZCodeAgent(
  _provider?: ZCodeProvider | null,
): ZCodeProvider {
  return SECRETARIAT_AGENT_PROVIDER;
}

export function normalizeAgentProvidersToZCodeAgent(
  _providers?: ReadonlyArray<ZCodeProvider> | null,
): ZCodeProvider[] {
  return [...SECRETARIAT_ENABLED_AGENT_PROVIDERS];
}

export function normalizeCommandAgentSourceToZCodeAgent(
  _agentSource?: CommandAgentSource | null,
): CommandAgentSource {
  return SECRETARIAT_COMMAND_AGENT_SOURCE;
}

export function isZCodeAgentProvider(
  provider: ZCodeProvider | null | undefined,
): provider is typeof SECRETARIAT_AGENT_PROVIDER {
  return provider === SECRETARIAT_AGENT_PROVIDER;
}
