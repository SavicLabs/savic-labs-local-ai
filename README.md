# SavicLabs Local AI for Copilot Chat

Use a local or self-hosted OpenAI-compatible model from the GitHub Copilot Chat model picker.

The extension registers a language model provider with VS Code, so models from
[llama.cpp](https://github.com/ggml-org/llama.cpp), [Ollama](https://ollama.com),
[vLLM](https://github.com/vllm-project/vllm), or any server that implements
`/v1/models` and `/v1/chat/completions` appear alongside Copilot's own models.
Nothing is proxied through SavicLabs: requests go from VS Code to the endpoint you
configure.

## Requirements

- VS Code 1.125.0 or newer
- The [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) extension
- One reachable OpenAI-compatible endpoint

## Installation

Install **SavicLabs — Local AI for Copilot** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SavicLabs.savic-labs-local-ai).

## Quick start

1. Start a server that exposes an OpenAI-compatible API. For example:

   ```bash
   ollama serve                       # http://127.0.0.1:11434/v1
   llama-server -m model.gguf         # http://127.0.0.1:8080/v1
   vllm serve <model>                 # http://127.0.0.1:8000/v1
   ```

2. Run **SavicLabs: Configure Backends** from the Command Palette.
3. Open Copilot Chat, open the model picker, and choose a model under **SavicLabs**.
4. Run **SavicLabs: Check Backend Health** at any time to confirm which endpoints
   are reachable.

Several endpoints can be configured at once. Models are aggregated into one list and
labelled with their source, so two servers offering the same model ID do not collide.

## Supported backends

| Backend | Default endpoint | Notes |
| --- | --- | --- |
| llama.cpp (`llama-server`) | `http://127.0.0.1:8080/v1` | Reports model load state and context size |
| llama.cpp router | `http://127.0.0.1:18080/v1` | Default when no endpoints are configured |
| Ollama | `http://127.0.0.1:11434/v1` | Models are always ready; no load polling |
| vLLM | `http://127.0.0.1:8000/v1` | No load-state reporting |
| OpenAI-compatible cloud APIs | varies | Requires an API key; see [Providers](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/docs/providers.md) |

Backend capabilities are read from `/v1/models` rather than assumed. Context size
follows the value the server reports; when the server does not report one, a
conservative default is used.

## Features

- **Model discovery** from `/v1/models`, aggregated across all configured endpoints.
- **Per-model configuration** in the picker: context limit, output limit, and reasoning effort.
- **Reasoning output** rendered as collapsible thinking where the model supports it.
- **Tool calling** for agent mode.
- **Vision proxy**: images are described by a vision-capable Copilot model before being
  sent to a text-only local model.
- **Context protection**: prompts are estimated and truncated before they exceed the
  model's reported context window.
- **Streaming** with stall detection, timeouts, and bounded retries on transient failures.

## Configuration

All settings live under `savicLabs`. The defaults are usable without configuration.

| Setting | Default | Purpose |
| --- | --- | --- |
| `savicLabs.endpoints` | `[]` | Endpoints to aggregate models from |
| `savicLabs.baseUrl` | `http://127.0.0.1:18080/v1` | Fallback endpoint when `endpoints` is empty |
| `savicLabs.maxTokens` | `0` | Global output cap; `0` leaves it to the API |
| `savicLabs.requestTimeoutMs` | `120000` | Request timeout in milliseconds |
| `savicLabs.modelIdOverrides` | `{}` | Map a picker model ID to a different API model ID |
| `savicLabs.visionModel` | `""` | Copilot model used to describe images; empty auto-detects |
| `savicLabs.debugMode` | `minimal` | `minimal`, `metadata`, or `verbose` |

API keys are **not** stored in settings. They are kept in VS Code's SecretStorage and
are only sent to the endpoint they belong to.

Full reference: [Configuration](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/docs/configuration.md).

## Commands

| Command | Purpose |
| --- | --- |
| **SavicLabs: Configure Backends** | Add, remove, or change endpoints and API keys |
| **SavicLabs: Check Backend Health** | Probe each endpoint and report reachability |
| **SavicLabs: Refresh Models** | Re-query the endpoints and rebuild the picker |
| **SavicLabs: Configure Vision Proxy** | Choose the model used for image descriptions |
| **SavicLabs: Show Logs** | Open the SavicLabs output channel |
| **SavicLabs: Open Request Dumps Folder** | Open the debug dump directory |

## Documentation

- [Configuration reference](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/docs/configuration.md)
- [Providers and cloud models](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/docs/providers.md)
- [Troubleshooting](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/docs/troubleshooting.md)
- [Architecture](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/docs/architecture.md)
- [Changelog](CHANGELOG.md)

## Development

```bash
npm ci
npm run compile      # build to out/
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm test             # compile, then run the test suite
npm run package      # produce a .vsix
```

Tests use Node's built-in test runner with a stubbed `vscode` module, so no extension
host or network access is required. See [CONTRIBUTING.md](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/CONTRIBUTING.md).

## Security

Report vulnerabilities as described in [SECURITY.md](https://github.com/SavicLabs/savic-labs-local-ai/blob/main/SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
