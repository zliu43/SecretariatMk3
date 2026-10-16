import {
  SECRETARIAT_AGENT_PROVIDER,
  SECRETARIAT_COMMAND_AGENT_SOURCES,
  type ZCodeProvider,
  type CommandAgentSource,
} from "@zcode/shared";

export const COMMAND_AGENT_SOURCES = [
  ...SECRETARIAT_COMMAND_AGENT_SOURCES,
] as const satisfies readonly CommandAgentSource[];

export const COMMAND_AGENT_SOURCE_META: Record<
  CommandAgentSource,
  {
    labelId: string;
    provider: ZCodeProvider;
    pathHint: string;
  }
> = {
  zcodeAgent: {
    labelId: "settings.commands.source.zcodeAgent",
    pathHint: "~/.secretariat/commands",
    provider: SECRETARIAT_AGENT_PROVIDER,
  },
};
