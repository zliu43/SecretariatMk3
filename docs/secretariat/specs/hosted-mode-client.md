# Hosted mode: agent side

Issue #46 (part 3). Plan: PLAN.md §2, "Gateway and tool hub". The gateway itself is #43.

## Configuration

| Variable                      | Required       | Meaning                                                                                                                    |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SECRETARIAT_GATEWAY_URL`     | with the token | Gateway base URL. The agent calls `<url>/v1/messages` (Anthropic Messages API, streaming).                                 |
| `SECRETARIAT_GATEWAY_TOKEN`   | with the URL   | The user's Secretariat token, sent as the API key. Guarded like any credential (environment guard, `deployment register`). |
| `SECRETARIAT_MODEL`           | no             | Default model, an OpenRouter model ID enabled in the bundled config. Unset: the gateway's first enabled model.             |
| `SECRETARIAT_REASONING_LEVEL` | no             | Reasoning level for that model. Unset: the model's highest level (the same as picking it by hand).                         |

Setting only one of URL and token is an error at startup. Neither set: hosted mode is off and the
agent uses its normal provider config (direct mode).

## Behaviour

- The gateway appears as a provider `secretariat-gateway` on the OpenRouter template, so it has
  OpenRouter's model list and model rules; the gateway passes model IDs through to OpenRouter.
- It is listed first and becomes the default selection when `SECRETARIAT_MODEL` is set.
- It lives only in memory. Edits to the personal provider config are written without it, so the
  token never reaches `provider_config.json`, and a user's own default selection is kept.
- Applies to the headless CLI and to the desktop services alike (both read the environment).

## Testing

`scripts/secretariat/mock-gateway.mjs` stands in for the gateway: it speaks the Messages API, checks the
token and logs each request without content. `scripts/secretariat/e2e-smoke.sh` runs hosted mode
against it.
