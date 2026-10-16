import {
  SECRETARIAT_AGENT_PROVIDER,
  SECRETARIAT_AGENT_PROVIDER_LABEL,
  type ZCodeProvider,
} from "@zcode/shared";

export const SECRETARIAT_AGENT_PROVIDERS: ZCodeProvider[] = [SECRETARIAT_AGENT_PROVIDER];

export const SECRETARIAT_AGENT_PROVIDER_LABELS: Record<ZCodeProvider, string> = {
  glm: SECRETARIAT_AGENT_PROVIDER_LABEL,
};

export function supportsZCodeSessionFork(provider: ZCodeProvider): boolean {
  void provider;
  // 功能开关：fork 入口恢复对所有 Secretariat provider 开放；实际可操作性仍由 task 状态、
  // assistant 目标和运行中保护 guard 控制，避免把 active/failed 分支暴露为可 fork。
  return true;
}

export function shouldHideZCodeSessionForkAction(provider: ZCodeProvider): boolean {
  return !supportsZCodeSessionFork(provider);
}
