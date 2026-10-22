import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAgentProfileFromMarkdown } from "@zcode/shared";
import {
  NodeZCodeBuiltinProviderConfigSource,
  SECRETARIAT_GATEWAY_PROVIDER_ID,
} from "../src/index.js";

// Secretariat model lineup (#46): GLM 5.3 Flash is the default, GPT 6.1 Sol runs the
// deep-research and coder subagents (config/agents/).
const DEFAULT_MODEL = "z-ai/glm-5.3-flash";
const DEEP_MODEL = "openai/gpt-6.1-sol";

const configPath = fileURLToPath(
  new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
);
const source = new NodeZCodeBuiltinProviderConfigSource({
  bundledFilePath: configPath,
  watch: false,
});
let snapshot: Awaited<ReturnType<typeof source.read>>;

beforeAll(async () => {
  snapshot = await source.read();
});
afterAll(() => source.dispose());

function resolveThroughGateway(modelId: string) {
  // The gateway provider uses the OpenRouter template with the gateway's own base URL.
  return snapshot.models.resolve({
    providerId: SECRETARIAT_GATEWAY_PROVIDER_ID,
    templateId: "openrouter",
    modelId,
    apiType: "anthropic-messages",
    baseUrl: "https://gateway.example",
  });
}

describe("Secretariat model lineup", () => {
  it("offers only GLM 5.3 Flash and GPT 6.1 Sol under OpenRouter, default first", () => {
    const template = snapshot.providerTemplates!.get("openrouter")!.config;
    expect(template.builtinModelIds).toEqual([DEFAULT_MODEL, DEEP_MODEL]);
    for (const modelId of template.builtinModelIds!) {
      const model = resolveThroughGateway(modelId);
      expect(model.enabled, modelId).toBe(true);
      expect(model.validateComplete(), modelId).toEqual([]);
    }
  });

  it("gives GPT 6.1 Sol at least GLM 5.3 Flash's limits and OpenAI reasoning levels", () => {
    const flash = resolveThroughGateway(DEFAULT_MODEL);
    const sol = resolveThroughGateway(DEEP_MODEL);
    expect(sol.properties!.contextWindow!).toBeGreaterThanOrEqual(flash.properties!.contextWindow!);
    expect(sol.optionSpecs!.maxOutputTokens!.max!).toBeGreaterThanOrEqual(
      flash.optionSpecs!.maxOutputTokens!.max!,
    );
    expect(sol.properties!.supportsJsonSchemaOutput).toBe(true);
    expect(sol.optionSpecs!.reasoningLevel!.values).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it.each(["deep-research", "coder"])(
    "the %s subagent runs on GPT 6.1 Sol through the gateway",
    async (name) => {
      const content = await readFile(
        new URL(`../../../config/agents/${name}.md`, import.meta.url),
        "utf8",
      );
      const { profile, diagnostic } = parseAgentProfileFromMarkdown({ content, source: "user" });
      expect(diagnostic).toBeUndefined();
      expect(profile?.name).toBe(name);
      expect(profile?.modelSelection).toEqual({
        providerId: SECRETARIAT_GATEWAY_PROVIDER_ID,
        modelId: DEEP_MODEL,
        options: { reasoningLevel: "high" },
      });
      const levels = resolveThroughGateway(DEEP_MODEL).optionSpecs!.reasoningLevel!.values!;
      expect(levels).toContain(profile!.modelSelection!.options!.reasoningLevel);
    },
  );
});
