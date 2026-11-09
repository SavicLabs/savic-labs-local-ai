# Configuration reference

Every setting lives under the `savicLabs` section. Settings are read live; changing
one of the endpoint, timeout, or override settings refreshes the model list.

## Endpoints

| Setting | Type | Default |
| --- | --- | --- |
| `savicLabs.endpoints` | `string[]` | `[]` |
| `savicLabs.baseUrl` | `string` | `http://127.0.0.1:18080/v1` |

`endpoints` is the list of servers to aggregate models from. Each entry should be the
`/v1` base of an OpenAI-compatible API; `/models` and `/chat/completions` are appended
to it. If `endpoints` is empty, `baseUrl` is used on its own.

Trailing slashes are ignored, so `http://127.0.0.1:8080/v1` and
`http://127.0.0.1:8080/v1/` are the same endpoint.

## Limits and timeouts

| Setting | Type | Default | Range |
| --- | --- | --- | --- |
| `savicLabs.maxTokens` | `number` | `0` | `0` or greater |
| `savicLabs.requestTimeoutMs` | `number` | `120000` | clamped to 5000–3600000 |

`maxTokens` caps the response length for every model. `0` omits `max_tokens` from the
request so the server's own default applies. Per-model limits set in the picker take
precedence over this value.

`requestTimeoutMs` bounds a single HTTP request. Values outside the accepted range are
clamped rather than rejected, so a stray `0` cannot produce an instant timeout. Large
models that need to load from disk may require a higher value.

## Model ID overrides

| Setting | Type | Default |
| --- | --- | --- |
| `savicLabs.modelIdOverrides` | `Record<string, string>` | `{}` |

Maps a model ID shown in the picker to a different ID sent to the API. This is useful
when a server reports an internal name but expects another one at request time.

Keys may be written either as the full picker ID (`qwen3@ollama`) or as the plain model
ID (`qwen3`). A full-ID key wins; the plain form exists for configuration written before
picker IDs became source-unique.

## Vision proxy

| Setting | Type | Default |
| --- | --- | --- |
| `savicLabs.visionModel` | `string` | `""` |
| `savicLabs.visionPrompt` | `string` | built-in prompt |

Local text-only models cannot accept images. When an image is attached, the extension
asks a vision-capable model available to VS Code to describe it and inserts that
description into the prompt.

- `visionModel` selects the describing model by VS Code language model ID. When empty,
  the first available vision-capable model is used.
- `visionPrompt` replaces the built-in instruction sent to the describing model.

The description is generated through VS Code's language model API, so image content is
handled by whichever Copilot model is selected — not by the local server.

## Diagnostics

| Setting | Type | Default | Values |
| --- | --- | --- | --- |
| `savicLabs.debugMode` | `string` | `minimal` | `minimal`, `metadata`, `verbose` |

- `minimal` — errors and warnings only.
- `metadata` — adds request classification, message and tool counts, and token usage to
  the **SavicLabs** output channel.
- `verbose` — everything in `metadata`, plus one JSON file per request written to the
  extension's global storage `dumps/` directory
  (**SavicLabs: Open Request Dumps Folder** opens it).

Dumps record metadata only — timestamp, model ID, request kind, message count, tool
count. Message content is deliberately not written to disk.

| Setting | Type | Default |
| --- | --- | --- |
| `savicLabs.experimental.stabilizeToolList` | `boolean` | `false` |

Experimental: activates the tool list before the first request to improve prompt-cache
reuse. Off by default because it adds an extra round trip on cold starts.

## Per-model settings

These are configured from the model picker's gear icon, not from `settings.json`.

**Max Context** limits how many input tokens are sent. Every model offers:

- `Server default` — use the context size the server reports.
- Fixed sizes below the server's context (4K, 8K, 16K, 32K, 64K, 128K).
- The server's full context as an explicit value when it is not one of the above.

Models detected as cloud models instead offer 32K through 1M plus **Unlimited**.

**Max Output Tokens** offers Unlimited, 512, 1K, 2K, 4K, 8K, 16K, 32K and 64K for local
models, and Unlimited through 128K for cloud models. Unlimited omits the limit.

**Reasoning Effort** appears only for models detected as reasoning-capable: `none`,
`high` (default) or `max`. It is sent as `thinking` and `reasoning_effort` parameters,
and is suppressed automatically for trivial requests such as file reads.

## API keys

API keys live in the `savicLabs.apiKeys` setting, as a map from endpoint URL to key:

```json
{
  "savicLabs.apiKeys": {
    "https://api.z.ai/api/paas/v4": "your-key"
  }
}
```

The key for an endpoint is sent only to that endpoint, as
`Authorization: Bearer <key>`. Local servers (Ollama, llama.cpp, vLLM) do not need one.

Note that this stores the key in plain text in your VS Code settings file. Use
**SavicLabs: Configure Backends** rather than editing settings by hand where possible,
and avoid committing `.vscode/settings.json` if it contains keys.
