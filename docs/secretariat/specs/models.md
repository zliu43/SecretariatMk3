# Models

Issue #46 (part 2). Decision: PLAN.md §7, decision 22.

## Lineup

| Model         | OpenRouter ID        | Used for                                                               |
| ------------- | -------------------- | ---------------------------------------------------------------------- |
| GLM 5.3 Flash | `z-ai/glm-5.3-flash` | Default: the conversation, background calls, the built-in subagents.   |
| GPT 6.1 Sol   | `openai/gpt-6.1-sol` | The `deep-research` and `coder` subagents; can also be picked by hand. |

The bundled config (`config/provider/zcode-builtin.json` and `.test.json`) lists only these two under the
OpenRouter template, GLM 5.3 Flash first, and enables only them. The hosted gateway provider and a
personal OpenRouter provider both use that template. GPT 6.1 Sol shares GPT 6 Astra's rules (1.05M
context, 128k output, reasoning `low`–`max`, JSON schema output, OpenRouter `output_config.effort`
mapping); it is at least as capable as GLM 5.3 Flash on every limit.

Other templates (Z.ai, direct vendor APIs) are untouched here; they go with #48.

## How a model is chosen

A selection is provider + model + reasoning level; all three are required.

1. **New conversation.** The configured default if usable (provider not hidden, model enabled, level
   valid): `SECRETARIAT_MODEL` / `SECRETARIAT_REASONING_LEVEL` in hosted mode, otherwise
   `defaultModelSelection` in `provider_config.json`. A default missing only its level gets the model's
   highest level. Without a usable default: the first visible provider's first enabled model at its
   highest level, which is GLM 5.3 Flash.
2. **During a conversation.** The selection is stored per conversation and changed with `/model`,
   `/effort` or the desktop picker.
3. **Background calls** (titles, memory, web fetch/search summaries): the conversation's model at its
   lowest reasoning level, capped at 5,000 output tokens.
4. **Subagents**, first match wins:
   1. a per-run override from the host;
   2. the profile's `model:` (`<providerId>/<modelId>`) and `thoughtLevel:`. If that model is not
      usable the subagent fails with a configuration error; it never falls back to the parent model;
   3. otherwise (`model: inherit` or none) the parent conversation's current model.

   The built-in `general-purpose` and `explore` agents inherit unless pinned with
   `builtInModelSelectionOverrides`.

The main model decides when to delegate, from each subagent's `description`. Nothing routes by topic.

## Subagent profiles

`config/agents/deep-research.md` and `config/agents/coder.md` run on
`secretariat-gateway/openai/gpt-6.1-sol` at reasoning level `high`. Install them by copying into the
user agents directory, `~/.secretariat/agents/` (or `$SECRETARIAT_DATA_BASE_DIR/.secretariat/agents/`).
In direct mode, change the provider part of `model:` to your OpenRouter provider's ID.

## Testing

- `packages/provider-node/test/secretariat-model-lineup.test.ts`: the lineup, GPT 6.1 Sol's limits and
  levels, and that both profiles parse to a usable GPT 6.1 Sol selection.
- `scripts/secretariat/e2e-smoke.sh`: the gateway receives GLM 5.3 Flash by default and GPT 6.1 Sol
  when `SECRETARIAT_MODEL` names it.
