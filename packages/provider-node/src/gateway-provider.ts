import { createHash } from "node:crypto";
import {
  ApiKeyAccessConfig,
  ProviderApiConfig,
  ProviderConfig,
  type PersonalProviderConfigRepository,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";

// Hosted mode (PLAN.md §2): the agent reaches models only through the Secretariat gateway, which
// speaks the Anthropic Messages API and forwards to OpenRouter. The gateway is configured by
// environment, never written to the personal provider config file.

export const SECRETARIAT_GATEWAY_URL_ENV = "SECRETARIAT_GATEWAY_URL";
export const SECRETARIAT_GATEWAY_TOKEN_ENV = "SECRETARIAT_GATEWAY_TOKEN";
export const SECRETARIAT_MODEL_ENV = "SECRETARIAT_MODEL";
export const SECRETARIAT_REASONING_LEVEL_ENV = "SECRETARIAT_REASONING_LEVEL";
export const SECRETARIAT_GATEWAY_PROVIDER_ID = "secretariat-gateway";
/** The gateway passes OpenRouter model IDs through, so it reuses the OpenRouter template's models. */
export const SECRETARIAT_GATEWAY_TEMPLATE_ID = "openrouter";

export interface GatewayProviderSettings {
  readonly baseUrl: string;
  readonly token: string;
  /** Default model; without it the gateway's first enabled model is used (it is listed first). */
  readonly modelId?: string;
  /** Reasoning level for the default model; without it, the model's highest level is used. */
  readonly reasoningLevel?: string;
}

/** Null when hosted mode isn't configured. Throws when it's half-configured or the URL is invalid. */
export function resolveGatewayProviderSettings(
  env: Readonly<Record<string, string | undefined>>,
): GatewayProviderSettings | null {
  const baseUrl = env[SECRETARIAT_GATEWAY_URL_ENV]?.trim();
  const token = env[SECRETARIAT_GATEWAY_TOKEN_ENV]?.trim();
  if (!baseUrl && !token) return null;
  if (!baseUrl || !token) {
    throw new Error(
      `${SECRETARIAT_GATEWAY_URL_ENV} and ${SECRETARIAT_GATEWAY_TOKEN_ENV} must be set together.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`${SECRETARIAT_GATEWAY_URL_ENV} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${SECRETARIAT_GATEWAY_URL_ENV} must use http or https.`);
  }
  const modelId = env[SECRETARIAT_MODEL_ENV]?.trim();
  const reasoningLevel = env[SECRETARIAT_REASONING_LEVEL_ENV]?.trim();
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    ...(modelId ? { modelId } : {}),
    ...(reasoningLevel ? { reasoningLevel } : {}),
  };
}

/**
 * Presents the personal provider config with the gateway provider added and selected as the default
 * model. Writes go to the underlying repository with the gateway provider removed, so the token never
 * reaches the config file.
 */
export class GatewayOverlayPersonalRepository implements PersonalProviderConfigRepository {
  readonly #inner: PersonalProviderConfigRepository;
  readonly #settings: GatewayProviderSettings;
  readonly #revisionSuffix: string;

  constructor(inner: PersonalProviderConfigRepository, settings: GatewayProviderSettings) {
    this.#inner = inner;
    this.#settings = settings;
    // Revisions can be logged, so they carry a hash of the non-secret settings only.
    this.#revisionSuffix = createHash("sha256")
      .update(`${settings.baseUrl}\n${settings.modelId ?? ""}\n${settings.reasoningLevel ?? ""}`)
      .digest("hex")
      .slice(0, 12);
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    return this.#overlay(await this.#inner.read());
  }

  onDidChange(listener: (reason: string) => void): () => void {
    return this.#inner.onDidChange(listener);
  }

  async update(
    transform: (current: ProviderConfigLayerSnapshot) => ProviderConfigLayerUpdate,
  ): Promise<ProviderConfigLayerSnapshot> {
    const updated = await this.#inner.update((current) =>
      this.#strip(transform(this.#overlay(current)), current),
    );
    return this.#overlay(updated);
  }

  #overlay(snapshot: ProviderConfigLayerSnapshot): ProviderConfigLayerSnapshot {
    const id = SECRETARIAT_GATEWAY_PROVIDER_ID;
    const providers = snapshot.providers.delete(id).setRule({
      providerId: id,
      templateId: SECRETARIAT_GATEWAY_TEMPLATE_ID,
      providerName: "Secretariat gateway",
      config: new ProviderConfig({
        group: "standard-personal",
        api: new ProviderApiConfig({ baseUrl: this.#settings.baseUrl }),
        access: new ApiKeyAccessConfig({ apiKey: this.#settings.token }),
      }),
    });
    const providerOrder = [id, ...(snapshot.providerOrder ?? []).filter((entry) => entry !== id)];
    return {
      ...snapshot,
      revision: `${snapshot.revision}+gateway:${this.#revisionSuffix}`,
      providers: providers.reorder(providerOrder),
      providerOrder,
      ...(this.#settings.modelId
        ? {
            defaultModelSelection: {
              providerId: id,
              modelId: this.#settings.modelId,
              ...(this.#settings.reasoningLevel
                ? { options: { reasoningLevel: this.#settings.reasoningLevel } }
                : {}),
            },
          }
        : {}),
    };
  }

  #strip(
    update: ProviderConfigLayerUpdate,
    current: ProviderConfigLayerSnapshot,
  ): ProviderConfigLayerUpdate {
    const id = SECRETARIAT_GATEWAY_PROVIDER_ID;
    const defaultModelSelection =
      update.defaultModelSelection?.providerId === id
        ? current.defaultModelSelection
        : update.defaultModelSelection;
    return {
      ...update,
      providers: update.providers.delete(id),
      ...(update.providerOrder
        ? { providerOrder: update.providerOrder.filter((entry) => entry !== id) }
        : {}),
      defaultModelSelection,
    };
  }
}
