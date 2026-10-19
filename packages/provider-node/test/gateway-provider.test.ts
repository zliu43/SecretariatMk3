import { ApiKeyAccessConfig, ProviderConfig, ProviderConfigMap } from "@zcode/provider";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GatewayOverlayPersonalRepository,
  NodePersonalProviderConfigRepository,
  resolveGatewayProviderSettings,
  SECRETARIAT_GATEWAY_PROVIDER_ID,
} from "../src/index.js";

const roots: string[] = [];
const owners: NodePersonalProviderConfigRepository[] = [];

afterEach(async () => {
  owners.splice(0).forEach((owner) => owner.dispose());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repositories(settings = { baseUrl: "http://gw.test", token: "gw-secret-token" }) {
  const root = await mkdtemp(join(tmpdir(), "secretariat-gateway-provider-"));
  roots.push(root);
  const filePath = join(root, "provider_config.json");
  const inner = new NodePersonalProviderConfigRepository({ filePath, pollingIntervalMs: false });
  owners.push(inner);
  return { filePath, inner, overlay: new GatewayOverlayPersonalRepository(inner, settings) };
}

describe("resolveGatewayProviderSettings", () => {
  it("is off when neither variable is set", () => {
    expect(resolveGatewayProviderSettings({})).toBeNull();
  });

  it("requires URL and token together, and a valid http(s) URL", () => {
    expect(() => resolveGatewayProviderSettings({ SECRETARIAT_GATEWAY_URL: "http://gw" })).toThrow(
      /must be set together/,
    );
    expect(() => resolveGatewayProviderSettings({ SECRETARIAT_GATEWAY_TOKEN: "t" })).toThrow(
      /must be set together/,
    );
    expect(() =>
      resolveGatewayProviderSettings({
        SECRETARIAT_GATEWAY_URL: "ftp://gw",
        SECRETARIAT_GATEWAY_TOKEN: "t",
      }),
    ).toThrow(/http or https/);
  });

  it("reads model and reasoning level and trims a trailing slash", () => {
    expect(
      resolveGatewayProviderSettings({
        SECRETARIAT_GATEWAY_URL: "https://gw.example/",
        SECRETARIAT_GATEWAY_TOKEN: "t",
        SECRETARIAT_MODEL: "anthropic/claude-opus-5",
        SECRETARIAT_REASONING_LEVEL: "low",
      }),
    ).toEqual({
      baseUrl: "https://gw.example",
      token: "t",
      modelId: "anthropic/claude-opus-5",
      reasoningLevel: "low",
    });
  });
});

describe("GatewayOverlayPersonalRepository", () => {
  it("adds the gateway provider first, on the OpenRouter template", async () => {
    const { overlay } = await repositories();
    const snapshot = await overlay.read();
    const rule = snapshot.providers.getRule(SECRETARIAT_GATEWAY_PROVIDER_ID);
    expect(rule?.templateId).toBe("openrouter");
    expect(rule?.config.api?.baseUrl).toBe("http://gw.test");
    expect((rule!.config.access as ApiKeyAccessConfig).apiKey).toBe("gw-secret-token");
    expect(snapshot.providers.keys()[0]).toBe(SECRETARIAT_GATEWAY_PROVIDER_ID);
    expect(snapshot.providerOrder?.[0]).toBe(SECRETARIAT_GATEWAY_PROVIDER_ID);
    expect(snapshot.revision).not.toContain("gw-secret-token");
  });

  it("selects the configured model as the default, with its reasoning level", async () => {
    const { overlay } = await repositories({
      baseUrl: "http://gw.test",
      token: "t",
      modelId: "m1",
      reasoningLevel: "low",
    } as never);
    expect((await overlay.read()).defaultModelSelection).toEqual({
      providerId: SECRETARIAT_GATEWAY_PROVIDER_ID,
      modelId: "m1",
      options: { reasoningLevel: "low" },
    });
  });

  it("never writes the gateway provider or its token to the config file", async () => {
    const { overlay, filePath } = await repositories();
    await overlay.update((current) => ({
      ...current,
      providers: current.providers.set(
        "my-provider",
        new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ apiKey: "own-key" }),
        }),
      ),
      defaultModelSelection: { providerId: SECRETARIAT_GATEWAY_PROVIDER_ID, modelId: "m1" },
    }));
    const written = await readFile(filePath, "utf8");
    expect(written).toContain("my-provider");
    expect(written).not.toContain(SECRETARIAT_GATEWAY_PROVIDER_ID);
    expect(written).not.toContain("gw-secret-token");
    // The overlaid view still shows both.
    const view = await overlay.read();
    expect(view.providers.has("my-provider")).toBe(true);
    expect(view.providers.has(SECRETARIAT_GATEWAY_PROVIDER_ID)).toBe(true);
  });

  it("keeps a user's own default selection in the file", async () => {
    const { overlay, inner } = await repositories();
    await overlay.update((current) => ({
      ...current,
      providers: ProviderConfigMap.empty(),
      defaultModelSelection: { providerId: "my-provider", modelId: "m2" },
    }));
    expect((await inner.read()).defaultModelSelection).toEqual({
      providerId: "my-provider",
      modelId: "m2",
    });
  });
});
