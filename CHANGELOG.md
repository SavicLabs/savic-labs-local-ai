# Changelog

All notable changes to the SavicLabs Local AI extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.10] — 2026-11-13

### Security
- Note: removing keys from `settings.json` does not erase historical backups,
  synchronised copies, or Git history. Rotate any key that was ever committed or synced.
- **API keys moved out of `settings.json`** — keys are stored in VS Code SecretStorage
  and sent only to the endpoint they belong to. A key left in the former
  `savicLabs.apiKeys` setting is migrated on first activation and the setting is removed;
  an existing SecretStorage value is never overwritten by a stale plaintext one.

### Fixed
- **Context-window guard never fired** — `checkContextWindow` passed a character count
  through an estimator that measures string length, so a 41,000-character conversation
  estimated as a single-digit token count and truncation never triggered.
- **Truncation mixed units** — the truncation loop compared character counts against a
  token budget, keeping roughly four times more text than intended.
- **`{imageCount}` was documented in the vision prompt setting but never substituted.**
  Custom vision prompts now receive the image count.

### Changed
- `npm run lint` now runs oxlint; type checking moved to `npm run typecheck`.
- Added a test suite (`npm test`) covering context estimation and truncation, model ID
  namespacing, picker metadata, token estimation, JSON serialisation, and API key
  migration and routing.
- Added a CI workflow running type check, lint, tests, and packaging on pull requests.
- Removed dead constants (`TOOLS_LIMIT`, `EXTERNAL_URLS`) and unused error-context
  parameters.
- Test files and lint configuration are excluded from the published VSIX.
- README rewritten; reference material moved to `docs/`.

## [0.10.9] — 2026-11-08

### Changed
- Excluded `.github/` from the published package.

## [0.10.8] — 2026-11-08

### Changed
- Releases publish to the VS Code Marketplace with Trusted Publishing (OIDC) instead of a
  stored personal access token.
- Upgraded `@vscode/vsce` to 4.1, which provides `publish --oidc`.

No runtime behaviour changed in 0.10.8 or 0.10.9.

## [0.10.7] — 2026-10-14

### Fixed — Context window
- **Local models no longer show as 64K when unloaded** — the llama.cpp router only returns GGUF
  metadata (`n_ctx` / `n_ctx_train`) for models that are **currently loaded**; unloaded models
  have no `meta` field at all. The parser defaulted the training limit to 65,536 and then clamped
  the real `--ctx-size` with it, so every non-resident model — including a 262,144-token (256K)
  preset — was reported as **64K** in the picker until it happened to be loaded. The training
  limit is now applied **only when it is actually known**; otherwise the server-reported
  `--ctx-size` is used as-is.
- The per-model **Max Context** dropdown now labels the server context correctly (e.g.
  "Server default (256K)") and offers the full server context as an explicit option.

## [0.10.6] — 2026-08-17

### Changed — Performance
- **Longer loaded-model cache for endpoints that never report load state** — `waitForModelLoaded` re-polled `/v1/models` every 30s per model, even for Ollama, vLLM, and cloud endpoints (z.ai, Verboo) that always report models as ready. Each z.ai poll costs ~400–600ms of pure server latency, paid on every request after 30s idle. These endpoints can't evict models, so their confirmation is now cached for **5 minutes** instead of 30s. The llama.cpp router (which reports `status` and *can* evict models) keeps the 30s TTL.

## [0.10.5] — 2026-08-17

### Fixed — Critical Performance
- **Up to 120s dead-wait before every cold-model request** — `waitForModelLoaded` polled `/v1/models` until the model reported `loaded`, but the llama.cpp router reports `unloaded` for models that haven't been requested yet, and **polling `/v1/models` never triggers a load — only the chat request does**. So every request to a cold (non-resident) model spun in the poll loop for the full 120s timeout *before* the chat request was even sent, then the model load time on top. Now returns immediately for `unloaded`/unknown-status models (and for models absent from a healthy `/v1/models` response, e.g. Ollama cold models), letting the chat request trigger the load directly.

## [0.10.4] — 2026-08-17

### Fixed — Critical
- **120-second hang on every chat request** — `waitForModelLoaded` compared the source-unique picker ID (e.g. `qwen3.6:27b-gpu@llama-cpp`) against the server's `/v1/models` response, which returns plain IDs (e.g. `qwen3.6:27b-gpu`). The lookup never matched, so every request spun in the model-load poll loop for up to 120s before proceeding (or timing out in Copilot Chat). Now strips the `@source` suffix before matching.
- **`modelIdOverrides` no longer silently ignored** — overrides configured before source-unique IDs existed were keyed by the plain model ID and stopped matching. Now falls back to the unsuffixed ID when no override matches the full picker ID.

## [0.10.3] — 2026-08-16

### Fixed
- **Retry on HTTP 429** — transient rate limits / service overload from cloud providers (z.ai, Verboo) are now retried with backoff instead of failing instantly.

## [0.10.2] — 2026-08-16

### Added — Verboo Code cloud support
- **Verboo Code (`code.verboo.ai`) is now recognized as a cloud provider** — models discovered from `https://code.verboo.ai/router/v1` are treated as cloud models, unlocking expanded context (up to 1M) and output (up to 128K) limits in the model picker.
- **Server-reported context windows are honored** — when an endpoint reports a `context_window` per model (as Verboo does, e.g. 256K for `qwen3.6-27b` vs 1M for others), that value is used instead of assuming a flat 1M for all cloud models.
- **Display names from the API** — endpoints that provide a `display_name` (e.g. "Kimi K3") now show that instead of the raw model ID.
- **Cloud flag propagated to the picker schema** — models from cloud sources get the cloud context/output options even when their context window is under 1M.

### Fixed — Multi-provider model handling
- **Source-unique model IDs** — models with the same ID from different endpoints (e.g. `glm-5.2` on both Verboo and z.ai) no longer collide in the Copilot model picker. Each entry is suffixed with its source (`glm-5.2@z-ai`), and the suffix is stripped before sending the API request.
- **Fixed request routing** — the source→endpoint routing table is now keyed by the same source-unique picker ID, so cloud models (z.ai, Verboo) route to their correct endpoint instead of falling back to the local server and failing with `model not found`.
- **Removed the hardcoded 3-model z.ai coding-plan whitelist** — all models returned by the coding-plan `/models` endpoint are now shown, since the endpoint accepts them.

## [0.10.0] — 2026-07-30

### Changed — Honest & Accurate Documentation
- **Corrected the z.ai (GLM) section of the README** to reflect the real model availability:
  - The **GLM Coding Plan** endpoint officially supports **only 3 models**: GLM-5.2, GLM-5-Turbo, and GLM-4.7. The previous README implied all GLM models were available on every endpoint.
  - The **Pay-as-you-go (PaaS)** endpoint offers the full catalog (GLM-5.2, GLM-5.1, GLM-5-Turbo, GLM-4.7, GLM-4.7-Flash, GLM-4.6, GLM-4.5, GLM-4.5-Air, GLM-4.5-Flash) with per-token billing.
  - **Removed the misleading "completely free, no payment required" claim** about the Flash models. They are listed as "Free" on z.ai's pricing page, but require a valid z.ai PaaS account with an active API key, and are **not** available on the Coding Plan endpoint.
  - Added the **quota multiplier** details (3× peak / 2× off-peak for GLM-5.2 & GLM-5-Turbo) so users understand why quota drains fast.
- The underlying model catalog in code was already accurate (coding plan exposes only 3 models); this release aligns the docs with reality.

## [0.9.2] — 2026-07-29

### Fixed — Critical Performance
- **Model load failures no longer retry for 6 minutes** — When a model has `status: failed` (e.g., insufficient VRAM), `waitForModelLoaded` threw a plain `Error` that was caught by its own retry loop and then retried 2 more times by the streaming retry loop — each attempt waiting up to 120s before timing out. Total: up to 6 minutes of retries for a model that can never load. Now throws a `NonRetryableError` that propagates immediately through all retry loops, surfacing the error to the user in seconds. The error message also includes the likely cause: "This usually means insufficient VRAM. Try stopping other models or use a smaller one."

### Added
- `NonRetryableError` class in `client/error.ts` for errors that should never be retried (model load failures, configuration errors, etc.)

## [0.9.1] — 2026-07-29

### Fixed — Bugs
- **Tool call deltas without `id` on first chunk no longer dropped** — Some servers defer `tc.id` to a later delta. Previously, the first delta for a tool call index was silently discarded if it lacked `id`, losing the function name and arguments. Now creates the entry immediately with a fallback id, and updates it when the real id arrives.
- **`waitForModelLoaded` no longer silently loops 120s on HTTP errors** — Non-OK responses (404, 500, etc.) were ignored with no `else` branch, causing a 120s spin. Now logs the status and returns early on 4xx errors.
- **Assistant messages with only thinking content no longer dropped** — `convertMessages` checked `content || toolCalls` but not `thinkingContent`. Reasoning-only turns were silently skipped, breaking reasoning replay. Now includes `thinkingContent` in the condition.
- **Classifier crash on null content** — `classifyApiRequest` accessed `messages[0].content` directly, which crashes on tool-call-only assistant messages where `content` is `null`. Now coerces with `String(... ?? '')`.
- **Debug dump filename sanitization** — Model IDs containing `/` and `:` (e.g., `org/Model-GGUF:Q4_K_M`) caused path traversal on Linux and crashes on Windows. Now sanitizes to `[a-zA-Z0-9._-]`.

### Removed — Dead Code
- Removed `setStallTimer` parameter from `streamChatCompletionOnce` (never passed by caller)
- Removed `getStabilizeToolListEnabled()` from `config.ts` (never called)
- Removed unused constants: `SHOW_LOGS_URI_PATH`, `CONFIGURE_ENDPOINT_URI_PATH`, `SET_VISION_MODEL_URI_PATH`, `LANGUAGE_MODEL_CHAT_SYSTEM_ROLE`, `WALKTHROUGH_ID`, `WELCOME_SHOWN_KEY`
- Removed misleading dead comment in `isCloudModel`

## [0.9.0] — 2026-07-29

### Fixed — Hardening Pass
- **Cache invalidation on config change** — `clientCache` and `loadedModelCache` in `request.ts` were never cleared on configuration changes, causing stale clients with old API keys to persist for the extension lifetime. Added `clearRequestCaches()` exported from `request.ts` and wired into the config change listener in `index.ts`. Also added `savicLabs.endpoints` to the watched config keys.
- **`isAbortError` too broad** — Was matching any error containing "cancelled" or "canceled" in its message (e.g., "Your subscription was canceled"), suppressing retries and hiding real errors. Now only checks `error.name === 'AbortError'`.
- **`dumpProviderInput` blocking hot path** — Changed from `await` to `void` (fire-and-forget) so disk I/O doesn't delay the first token.
- **Dead `hasImages` scan removed** — The full message iteration computed `hasImages` but the `if` body was empty. Vision handling already happens independently in `resolveImageMessages`.
- **No-op cancel listener removed** — `stream.ts` registered a cancellation listener that did nothing, then disposed it in `finally`. Removed entirely.

### Removed — Dead Code
- Removed `src/provider/tools/consts.ts` (`MAX_TOOLS` never imported)
- Removed `formatModelFields()` from `routing/classifier.ts` (never called)
- Removed `formatModelFields` re-export from `routing/index.ts`

## [0.8.2] — 2026-07-29

### Fixed — Critical
- **120-second timeout on every z.ai request** — `waitForModelLoaded()` called `GET /models` without the `Authorization` header. z.ai (and any cloud API requiring auth) returned HTTP 401, which was treated as "not OK" and silently retried for the full 120-second timeout. This added **120 seconds of pure waste** to every single chat request. Now sends the API key in the poll request, so z.ai returns 200, finds the model (no `status` field → immediate return), and caches for 30 seconds.

## [0.8.1] — 2026-07-29

### Fixed — z.ai Coding Plan Optimization
- **Coding Plan model filtering** — The z.ai Coding Plan endpoint (`/coding/paas/v4`) only supports 3 models: `glm-5.2`, `glm-5-turbo`, and `glm-4.7`. The `/models` endpoint lists 8 models, but only 3 actually work for chat completions on the Coding Plan. Now filters the API response to only show supported models when using the Coding Plan endpoint. All 9 models remain available on the PaaS (pay-as-you-go) endpoint.
- **Hardcoded catalog also filtered** — The fallback catalog now respects endpoint type: coding plan gets 3 models, PaaS gets all 9.
- **Quota cost display** — GLM-5.2 and GLM-5-Turbo now show "3× peak" in the model detail line, indicating they consume 3× quota during peak hours (14:00–18:00 UTC+8). GLM-4.7 shows "1× standard".

### Fixed — Context Caching
- **z.ai cached tokens now captured** — z.ai's API returns cache hits in `prompt_tokens_details.cached_tokens` (nested), but the extension only read `prompt_cache_hit_tokens` (llama.cpp format, top-level). Now reads both formats so VS Code Copilot Chat sees accurate cache hit data from z.ai.

### Note on `[1m]` suffix
- The `[1m]` suffix (e.g., `glm-5.2[1m]`) is only supported via the **Anthropic protocol** endpoint (`api.z.ai/api/anthropic`), used by Claude Code. The OpenAI-compatible coding plan endpoint (`api.z.ai/api/coding/paas/v4`) does **not** support the suffix — `glm-5.2` already gets 1M context natively on this endpoint.

## [0.8.0] — 2026-07-28

### Fixed — Critical
- **Token estimation was ~2x inflated** — `getMessageChars()` in `context.ts` double-counted text content because the thinking-part duck-type check was not in an `else` branch. Every `LanguageModelTextPart` (which has a `.value` property) matched both the text check AND the thinking check, doubling the character count. This caused `checkContextWindow()` to see ~2× the actual tokens, triggering premature context truncation and dropping valid conversation messages. **Highest-impact fix in this release.**
- **System messages sent as `'user'` role** — `mapRole()` in `convert.ts` mapped system messages (role=3) to `'user'` in the `default` case. System prompts were being sent as user messages, losing system-prompt semantics. Now correctly maps to `'system'`.
- **Vision `CancellationTokenSource` leaked per image** — `createVSCodeDescriber()` allocated a new `CancellationTokenSource` on every image description call without disposing it. Added proper `try/finally` with `dispose()`, plus a 30-second timeout to prevent indefinite blocking if the vision model hangs.
- **SSE chunks with `data:` (no space) silently dropped** — Some servers emit `data:{...}` without a space. The parser only checked for `'data: '` (with space), silently dropping those chunks. Now handles both formats.
- **Tool call deltas with missing `index` silently dropped** — Some servers omit `tc.index` for single-tool calls. `Map.get(undefined)` failed to accumulate subsequent deltas. Now defaults to index 0.

### Fixed — Robustness
- **`isCloudModel()` overly broad `includes('cloud')`** — The condition `lowerId.includes('cloud')` matched any model ID containing "cloud" anywhere (e.g., "cloudflare-detection"). Removed the overly broad third condition; now only matches `:cloud` suffix or `-cloud` ending.
- **`clientCache` unbounded growth** — Client cache never evicted entries. Added size cap of 10 with clear-on-overflow.
- **`waitForModelLoaded` silently swallowed all non-HTTP errors** — Malformed JSON, HTML responses, and other errors were silently caught with no logging, looping for 120s with zero feedback. Now logs each retry error at debug level.
- **`requestTimeoutMs` not bounds-checked** — A user could set `0` (instant timeout) or negative values. Now clamped to 5s–1h.

### Removed — Dead Code
- Removed `src/provider/segment.ts` (entire file — `resolveConversationSegment()` never called)
- Removed `dumpRequest()` and `observeCancellationToken()` from `debug/dump.ts` (never called)
- Removed `THINKING_FAMILIES` constant from `consts.ts` (never imported)

## [0.7.2] — 2026-07-28

### Fixed
- **Output tokens now truly unlimited by default** — The per-model picker sends `maxTokens` as a string (`'0'`), but the code read it as a number. String `'0'` was being sent directly as `max_tokens: '0'` to the API, which some APIs interpret as "generate 0 tokens". Now properly converts string values to numbers and omits `max_tokens` entirely when the value is 0 (Unlimited).
- **Cloud model output limit raised to 128K** — `CLOUD_MODEL_MAX_OUTPUT` was 65,536. Raised to 131,072 (128K) to match GLM-5.2's actual capability.

### Changed
- **Output token dropdown now differentiates cloud vs local** — Cloud models get: Unlimited / 4K / 8K / 16K / 32K / 64K / 128K. Local models keep: Unlimited / 512 / 1K / 2K / 4K / 8K / 16K / 32K / 64K. Default is **Unlimited** for both — output tokens don't pre-allocate VRAM so there's no reason to cap them.

## [0.7.1] — 2026-07-28

### Fixed
- **Critical: z.ai models not detected as cloud — context capped at server default** — z.ai's `/models` endpoint returns `owned_by: "z-ai"` (with a hyphen), but `isCloudModel()` only checked for `'z.ai'` (with a dot). `"z-ai".includes("z.ai")` is false, so z.ai models were treated as local and got the default 65536 context instead of 1M. Added `'z-ai'` to the cloud sources list. Also added z.ai hostname detection in the URL-based source label fallback path.

## [0.7.0] — 2026-07-28

### Changed — Performance Hardening
- **Stall timer optimization** — Replaced per-SSE-chunk `clearTimeout`+`setTimeout` (thousands of timer allocations on long thinking responses) with a single 5-second interval timer that checks a `lastChunkTime` timestamp. Eliminates timer churn and GC pressure on long reasoning streams from models like GLM-5.2.
- **Client caching** — `SavicLabsClient` instances are now cached by `(baseUrl, apiKey)` instead of being reconstructed on every chat request. Avoids unnecessary object allocation and config re-reads.
- **Request classification deduplication** — `classifyProviderRequest` in `index.ts` was calling `classifyApiRequest` again in `request.ts`. Now the result from the first classification pass is passed through `PrepareRequestInput.requestKind`, eliminating a redundant message-walking pass.
- **Debug dump gate** — `dumpProviderInput` is no longer called (or awaited) when debug mode is `minimal`. Previously it was always called, costing a microtask and config read on every request even when disabled.
- **Model loaded cache** — `waitForModelLoaded` now caches confirmed-loaded models for 30 seconds, skipping the `/v1/models` poll entirely on rapid successive requests to the same model. Eliminates redundant HTTP round-trips for already-loaded llama.cpp models.

### Removed — Dead Code
- Removed unused `deduplicateModels` function from `models.ts` (never called)
- Removed unused `processToolFlow` stub from `tools/flow.ts` (never imported)
- Removed unused `NO_MODEL` variable from `vision/service.ts`
- Removed unused `context` field from `VisionService` class
- Removed unused `SavicLabsClient` import from `models.ts`
- Removed unused `createUserFacingError` import from `request.ts`
- Removed empty `vision/sources/` directory
- Removed old .vsix files (0.3.0–0.6.1) from repository

### Fixed — Code Quality
- **TypeScript strictness** — Enabled `noUnusedLocals` and `noUnusedParameters` in `tsconfig.json`. All unused variables and parameters have been cleaned up.
- **`.vscodeignore`** — Added `*.vsix` to prevent accidental packaging of build artifacts

## [0.6.1] — 2026-07-27

### Fixed
- **Critical performance bug: 120-second delay on every Ollama/vLLM request** — `waitForModelLoaded()` polled `/v1/models` in a loop waiting for `status.value === 'loaded'`, but Ollama and vLLM endpoints don't return a `status` field in their model listings. This caused the function to loop with exponential backoff (500ms → 5s) for the full 120-second timeout before finally sending the chat request. Now returns immediately when a model is found but has no `status` field (meaning the endpoint doesn't report load state — models are always ready). This affects all Ollama models (local and cloud, including `glm-5.2:cloud`), vLLM, and any non-llama.cpp endpoint.

## [0.6.0] — 2026-07-27

### Added
- **z.ai (GLM Models) integration** — The extension now supports [z.ai](https://z.ai) cloud API, providing access to GLM coding models:
  - **GLM-5.2** (flagship, 1M context), GLM-5.1, GLM-5-Turbo, GLM-4.7, GLM-4.6, GLM-4.5, GLM-4.5-Air
  - **Free models**: GLM-4.7-Flash (200K context) and GLM-4.5-Flash (128K context) — no payment required
  - Two endpoint presets: **Pay-as-you-go** (`api.z.ai/api/paas/v4`) and **GLM Coding Plan** (`api.z.ai/api/coding/paas/v4`)
  - Guided setup via **SavicLabs: Configure Endpoint** → Cloud Providers → z.ai
  - Automatic model discovery with hardcoded fallback catalog (z.ai's `/models` endpoint may not always work)
  - Full thinking/reasoning support — `thinking` and `reasoning_effort` parameters match z.ai's API spec
- **API key authentication** — New `savicLabs.apiKeys` setting maps endpoint URLs to Bearer tokens:
  - Cloud providers (z.ai, etc.) require API keys — the extension sends `Authorization: Bearer <key>` headers
  - Local servers (Ollama, llama.cpp, vLLM) continue to work without keys — no behavior change
  - Keys are prompted during guided setup and saved automatically to settings
  - Config change listener refreshes the client when `apiKeys` is updated
- **Cloud provider presets in backend setup** — New "Cloud Providers" section in the Configure Endpoint quick pick

### Changed
- `SavicLabsClient` constructor now accepts an optional `apiKey` parameter (4th argument)
- `isCloudModel()` detection now includes `z.ai` and `bigmodel` in cloud source labels
- Version bumped to 0.6.0

## [0.5.0] — 2026-07-22

### Added
- **Cloud model unlimited context support** — Cloud models (identified by `:cloud` suffix in model ID, or by cloud provider source label) now get expanded context limits:
  - Max input context: up to **1,000,000 tokens** (1M) instead of server-capped 128K
  - Max output tokens: up to **65,536 tokens** (64K) instead of default 4K
  - Per-model configuration dropdown now includes **Unlimited** context option for cloud models
  - Context options for cloud models: 32K / 64K / 128K / 256K / 512K / 1M / Unlimited
- **Automatic cloud model detection** — No manual configuration needed. Models are detected as cloud via:
  - Model ID containing `:cloud` (e.g. `qwen3-coder-next:cloud`, `gpt-oss:120b-cloud`)
  - Source label matching known cloud providers: OpenAI, Anthropic, Groq, Together, Fireworks, OpenRouter, Mistral

### Fixed
- **specType parsing bug** — Fixed `specType` variable not being declared before `--spec-type` argument parsing in `parseModelEntry()`. This caused spec-type detection to silently fail after the source-label refactoring moved the cloud detection block above the spec-type parsing block. `specType` is now correctly initialized to `'none'` before parsing.