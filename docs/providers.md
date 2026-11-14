# Providers and cloud models

Any endpoint that implements `/v1/models` and `/v1/chat/completions` can be used. This
page covers the providers with specific handling.

## How a backend is treated

The extension reads `/v1/models` and derives everything else from the response:

- **Context size** comes from the model's reported context (`context_window`, or the
  llama.cpp `meta.n_ctx` / `meta.n_ctx_train` fields). A model served at 262,144 tokens
  is offered at 256K even while it is unloaded, as long as the server reports it.
  Server-reported values are never inflated.
- **Load state** is used only when the server reports it. llama.cpp reports `status`;
  Ollama and vLLM do not, and are treated as always ready rather than polled.
- **Thinking support** is inferred from the model ID and from llama.cpp's speculative
  decoding type (`draft-mtp` indicates a reasoning-capable draft head).

## Cloud detection

A model is treated as a cloud model when either:

- its ID ends with `:cloud` or `-cloud`, or
- its source label contains one of: `openai`, `anthropic`, `groq`, `together`,
  `fireworks`, `openrouter`, `mistral`, `z.ai`, `z-ai`, `bigmodel`, `verboo`.

Cloud models receive expanded context and output options in the picker. This is a
convenience, not a capability guarantee: the limits offered are the picker's ceilings,
and a request beyond what the provider accepts will be rejected by the provider.

## Server-reported overrides

If an endpoint returns `context_window` per model, that value wins over the cloud
default. A provider that serves one small model and one large model therefore shows
different limits for each.

## z.ai (GLM)

Two OpenAI-compatible endpoints are offered as presets:

| Preset | URL | Billing |
| --- | --- | --- |
| Pay-as-you-go | `https://api.z.ai/api/paas/v4` | Per token |
| GLM Coding Plan | `https://api.z.ai/api/coding/paas/v4` | Subscription |

Model availability differs between them and changes over time. The extension shows what
the endpoint's `/v1/models` returns. If that call fails, a bundled catalogue is used as a
fallback: the Coding Plan preset falls back to its subscription models only, the
pay-as-you-go preset to the full listed catalogue. The bundled catalogue is a fallback
for discovery — it is not a promise about what the provider currently serves.

A z.ai API key is required for both endpoints and is stored in SecretStorage.

## Configuring a cloud provider

1. Run **SavicLabs: Configure Backends**.
2. Choose the cloud provider preset, or enter any OpenAI-compatible URL.
3. Paste the API key when prompted. It is stored in SecretStorage, never in settings.
4. Run **SavicLabs: Refresh Models**.

To remove a key later, delete it from the endpoint entry via **Configure Backends**.

## Local network and self-hosted servers

Plain `http://` endpoints are supported for LAN and loopback addresses, which is the
normal case for a model server running on the same machine. The extension does not
refuse non-TLS endpoints; it also does not add credentials to any host you have not
configured. A key configured for one endpoint is never sent to another.

## Other providers

OpenAI, Anthropic's OpenAI-compatible endpoint, Groq, Together, Fireworks, OpenRouter and
Mistral work when added as plain endpoints with their own API key. They are not
special-cased beyond the cloud detection described above, so provider-specific features
outside the OpenAI schema are not used.
