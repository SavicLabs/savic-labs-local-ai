# Architecture

The extension is a VS Code language model provider. It owns no UI beyond commands, and
proxies chat requests from Copilot Chat to OpenAI-compatible endpoints.

## Requirements it depends on

- `vscode.lm.registerLanguageModelChatProvider` — registers the `SavicLabs` vendor.
- `LanguageModelChatProvider` — supplies model information, responses, and token counts.
- `SecretStorage` — stores API keys outside `settings.json`.

## Module map

```
src/
├── extension.ts          Activation, command and URI registration
├── config.ts             Settings reads (endpoints, limits, vision, debug)
├── secrets.ts            API key storage and legacy-setting migration
├── consts.ts             Compile-time constants and the z.ai fallback catalogue
├── logger.ts             Output channel wrapper
├── i18n.ts               User-facing strings
├── client/
│   ├── core.ts           SSE streaming client, retry, timeout, stall detection
│   └── error.ts          Typed errors and user-facing messages
└── provider/
    ├── index.ts          LanguageModelChatProvider implementation
    ├── models.ts         /v1/models discovery and picker metadata
    ├── request.ts        Request assembly, routing, model-load waiting
    ├── context.ts        Context-window estimation and truncation
    ├── stream.ts         Streaming into VS Code response parts
    ├── convert.ts        VS Code messages → OpenAI schema
    ├── tokens.ts         Token estimation and calibration
    ├── backend-setup.ts  Guided endpoint configuration
    ├── routing/          Request classification (chat / agent / trivial)
    ├── vision/           Image description via a Copilot vision model
    └── replay/           Reasoning replay markers
```

## Request lifecycle

1. **Model list.** Copilot Chat calls `provideLanguageModelChatInformation`. Models are
   fetched from every configured endpoint and cached for 30 seconds. Each model gets a
   source-unique picker ID, `<modelId>@<sourceLabel>`, and the ID → endpoint mapping is
   retained for routing.

2. **Request.** `provideLanguageModelChatResponse` receives the conversation, classifies
   it, checks the context budget, and prepares the request body.

3. **Routing.** The picker ID is resolved back to its endpoint and to the real API model
   ID (`@source` suffix stripped, `modelIdOverrides` applied). A client is created for
   that endpoint with that endpoint's key.

4. **Model load.** For servers that report load state, the client waits for the model to
   become available. Servers that do not report state skip this entirely — polling them
   would add latency without information. Confirmations are cached, with a shorter TTL
   for servers that can evict models.

5. **Streaming.** The response is read as SSE. Text, thinking, tool calls, and usage are
   emitted as they arrive. A stall timer aborts a stream that stops producing data, and
   a request timeout bounds the whole call. Transient failures retry with exponential
   backoff; 4xx errors and cancellation do not.

6. **Cancellation.** VS Code's cancellation token aborts the in-flight fetch.

## Design notes

- **No runtime dependencies.** The HTTP client is built on Node's `fetch`; there is no
  SDK between the extension and the endpoint.
- **Capabilities are read, not assumed.** Context size, load state, and reasoning support
  come from the server's response where it provides them. Fallbacks are conservative and
  documented in [Providers](providers.md).
- **Keys are scoped.** A key is looked up per endpoint and attached only to requests for
  that endpoint.
- **Errors are typed.** `HttpError`, `NetworkError`, and `NonRetryableError` distinguish
  "retry might help" from "it will not", which keeps failure paths short.
