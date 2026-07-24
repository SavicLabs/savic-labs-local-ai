# SavicLabs Local AI for Copilot Chat

Use your local llama.cpp models directly in GitHub Copilot Chat. **Zero config** — auto-discovers models, auto-detects thinking/reasoning capability, supports tool calling and vision proxy.

> Built on the same architecture as the DeepSeek V4 extension for Copilot Chat.

## Features

- **Zero-config model discovery** — Detects all models from your llama.cpp or OpenAI-compatible API endpoint via `/v1/models`
- **Context Window Protection** — Prevents overflow crashes by estimating tokens before sending and intelligently truncating when needed
- **Auto-retry & Timeout** — Retries on transient failures (503, network errors) with exponential backoff; configurable timeout
- **Stream Stall Detection** — Detects stalled streams (30s no data) and recovers
- **Model Load Progress** — Shows "Loading model..." with elapsed time while waiting for large models to load
- **Thinking/Reasoning** — Full support for Qwen's chain-of-thought with collapsible thinking blocks
- **Tool Calling** — Agent-mode tool support (file operations, terminal, search, etc.)
- **Vision Proxy** — Images automatically described by an available Copilot vision model (GPT-4o, Claude, etc.)
- **Request Classification** — Automatically disables thinking for trivial tasks (chat titles, todo tracking)
- **Token Usage Reporting** — Adaptive token estimation calibrated from real API usage
- **Debug Mode** — Verbose logging and request dumps for diagnostics
- **Model ID Overrides** — Map VS Code model IDs to different API model names

## Quick Start

1. Make sure your llama.cpp router is running (e.g., on `http://127.0.0.1:18080/v1`)
2. Open Copilot Chat (`Ctrl+Shift+I` / `Cmd+Shift+I`)
3. Click the model dropdown and find the **SavicLabs** section
4. Select a model and start chatting

### Configure Endpoint

Default endpoint: `http://127.0.0.1:18080/v1`

To change it:
- Command Palette → **SavicLabs: Configure Endpoint**
- Or set `savicLabs.baseUrl` in settings

## Settings

| Setting | Default | Description |
|---|---|---|
| `savicLabs.baseUrl` | `http://127.0.0.1:18080/v1` | API endpoint URL |
| `savicLabs.maxTokens` | `0` (unlimited) | Max output tokens per response |
| `savicLabs.requestTimeoutMs` | `120000` (2 min) | HTTP request timeout in ms |
| `savicLabs.modelIdOverrides` | `{}` | Map VS Code model IDs to API model IDs |
| `savicLabs.debugMode` | `minimal` | Logging verbosity: `minimal`, `metadata`, `verbose` |
| `savicLabs.visionModel` | `""` (auto-detect) | Model to use for image description |
| `savicLabs.visionPrompt` | *(built-in)* | Custom prompt for vision descriptions |
| `savicLabs.experimental.stabilizeToolList` | `false` | Experimental tool list stabilization |

## Commands

| Command | Description |
|---|---|
| **SavicLabs: Configure Endpoint** | Set the API endpoint URL |
| **SavicLabs: Refresh Models** | Re-discover models from the endpoint |
| **SavicLabs: Configure Vision Proxy** | Select a vision model for image descriptions |
| **SavicLabs: Show Logs** | Open the SavicLabs output log |
| **SavicLabs: Open Request Dumps Folder** | Open debug dump directory |

## Supported Model Architectures

### Thinking/Reasoning
- **Qwen3.6** (all sizes) — Full thinking support via `draft-mtp`
- **Qwen3.5** — Thinking support
- **QwQ** — Reasoning support

### No Thinking (standard chat)
- **Llama 3.1 / 3.2** — Standard chat, no reasoning blocks
- **Llama 4** — Standard chat
- Other architectures — Standard chat

Thinking capability is auto-detected from the model's `spec-type` and model ID. No manual configuration needed.

## Vision Proxy

Since local llama.cpp models are text-only, the extension uses a **vision proxy** to handle images:
1. You attach an image in chat
2. The extension detects it and sends it to an available Copilot vision model
3. The vision model describes the image in text
4. The text description is fed to your local model

Configure via **SavicLabs: Configure Vision Proxy** or the `savicLabs.visionModel` setting.

## Requirements

- VS Code `>= 1.116.0`
- A running llama.cpp server or OpenAI-compatible API endpoint
- [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) extension

## Architecture

```
SavicLabs Chat Provider
├── /v1/models        → Auto-discovery of models + capabilities
├── /v1/chat/completions → SSE streaming chat (OpenAI-compatible)
│   ├── Text content
│   ├── Thinking/reasoning content
│   ├── Tool calls
│   └── Usage reporting
└── Vision Proxy      → Image → Copilot vision model → text description
```

## Development

```bash
npm install
npm run compile
npm run watch    # Watch mode for development
npm run lint     # TypeScript type check
```

## License

MIT
