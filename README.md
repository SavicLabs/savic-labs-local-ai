# SavicLabs Local AI for Copilot Chat

Use your local AI models directly in GitHub Copilot Chat. Works with **any OpenAI-compatible API** — llama.cpp, Ollama, vLLM, text-generation-webui, or your own server.

> **World-class context management** — never crashes from context overflow. Intelligent truncation, auto-retry, stall detection, and model load progress built in.

---

## What You Need

This extension connects Copilot Chat to a **local or remote OpenAI-compatible API server**. You need one of these running:

| Backend | Default URL | Setup |
|---|---|---|
| **[Ollama](https://ollama.com)** | `http://127.0.0.1:11434/v1` | Install Ollama → `ollama pull qwen3` → done |
| **[llama.cpp](https://github.com/ggml-org/llama.cpp)** | `http://127.0.0.1:8080/v1` | `llama-server -m model.gguf` |
| **[vLLM](https://github.com/vllm-project/vllm)** | `http://127.0.0.1:8000/v1` | `vllm serve model-name` |
| **Anything OpenAI-compatible** | Your URL | `/v1/models` + `/v1/chat/completions` endpoints |

**The easiest way to start**: Install [Ollama](https://ollama.com), pull a model, and point the extension to `http://127.0.0.1:11434/v1`.

---

## Quick Start

1. **Start your server** (Ollama, llama.cpp, vLLM, etc.)
2. Open Copilot Chat (`Ctrl+Shift+I` / `Cmd+Shift+I`)
3. Click the model dropdown → **SavicLabs** section → pick a model
4. Start chatting

### Change the Endpoint

Default: `http://127.0.0.1:18080/v1`

- `Ctrl+Shift+P` → **SavicLabs: Configure Endpoint**
- Or set `savicLabs.baseUrl` in settings:

```json
{
  "savicLabs.baseUrl": "http://127.0.0.1:11434/v1"
}
```

---

## Features

- **Zero-config model discovery** — Detects all models from your OpenAI-compatible endpoint via `/v1/models`
- **Context Window Protection** — Prevents overflow crashes by estimating tokens and intelligently truncating
- **Auto-retry & Timeout** — Retries on transient failures (503, network errors) with exponential backoff
- **Stream Stall Detection** — Detects stalled streams (30s no data) and recovers
- **Model Load Progress** — Shows "Loading model..." while waiting for large models to load
- **Thinking/Reasoning** — Full Qwen chain-of-thought with collapsible thinking blocks
- **Tool Calling** — Agent-mode tools (file ops, terminal, search, etc.)
- **Vision Proxy** — Images auto-described by an available Copilot vision model
- **Request Classification** — Auto-disables thinking for trivial tasks
- **Token Usage Reporting** — Adaptive token estimation from real API data
- **Debug Mode** — Verbose logging and request dumps

## Settings
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

## Troubleshooting

### "No models showing in the picker"

1. Make sure your server is running: `curl http://127.0.0.1:18080/v1/models`
2. Run **SavicLabs: Refresh Models** from the Command Palette
3. Check the logs: **SavicLabs: Show Logs** → look for errors
4. Verify your endpoint URL in settings

### "Server error (HTTP 500)"

Your model may have failed to load. Restart your server and run **SavicLabs: Refresh Models**.

### "fetch failed"

Your server isn't running or the URL is wrong. Check the endpoint and try `curl`-ing it.

### Models appear but thinking doesn't work

Thinking is auto-detected from the model's spec-type and ID. Qwen-family models get thinking automatically. If your model supports reasoning but isn't detected, add it to `savicLabs.modelIdOverrides`.

---

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
