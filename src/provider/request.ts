/**
 * Request preparation — assembles the full chat completion request body.
 */
import * as vscode from 'vscode';
import { SavicLabsClient } from '../client';
import { NonRetryableError, HttpError } from '../client/error';
import type { ChatCompletionRequest } from '../client/core';
import {
  getBaseUrl,
  getApiModelId,
  getMaxTokens,
  getRequestTimeoutMs,
} from '../config';
import { getApiKeyForEndpoint } from '../secrets';
import { convertMessages, convertTools, countMessageChars } from './convert';
import { getConfiguredThinkingEffort } from './models';
import { shouldForceThinkingNone, formatRequestLogLine, classifyApiRequest, type RequestKind } from './routing/classifier';
import { resolveImageMessages } from './vision/resolve';
import type { VisionDescriber } from './vision/service';
import { logger } from '../logger';

export interface PreparedRequest {
  client: SavicLabsClient;
  request: ChatCompletionRequest;
  isThinkingModel: boolean;
  totalRequestChars: number;
  requestKind: string;
  segment: string;
  replayMarkerMetadata: { visionText?: string; reasoningText?: string };
  visionMarkerTextChars?: number;
  initialResponseNotice?: string;
  trailingToolResultIds: string[];
}

export interface PrepareRequestInput {
  modelInfo: vscode.LanguageModelChatInformation;
  messages: vscode.LanguageModelChatMessage[];
  options: vscode.LanguageModelChatRequestOptions;
  token: vscode.CancellationToken;
  getVisionDescriber: () => Promise<VisionDescriber | undefined>;
  sourceUrl?: string;
  /** Pre-classified request kind from index.ts (avoids duplicate classification pass). */
  requestKind?: RequestKind;
}

/** Cache of SavicLabsClient instances keyed by `${baseUrl}::${apiKey}`. */
const clientCache = new Map<string, SavicLabsClient>();

/** Clear all cached clients and model-loaded state. Called on config change. */
export function clearRequestCaches(): void {
  clientCache.clear();
  loadedModelCache.clear();
}

/** Get or create a cached client for the given endpoint. */
function getClient(baseUrl: string, timeoutMs: number, apiKey?: string): SavicLabsClient {
  const key = `${baseUrl}::${apiKey ?? ''}`;
  let client = clientCache.get(key);
  if (!client) {
    // Prevent unbounded growth — clear if too many entries
    if (clientCache.size > 10) clientCache.clear();
    client = new SavicLabsClient(baseUrl, timeoutMs, 2, apiKey);
    clientCache.set(key, client);
  }
  return client;
}

export async function prepareChatRequest(input: PrepareRequestInput): Promise<PreparedRequest> {
  const { modelInfo, messages, options, token, getVisionDescriber, sourceUrl, requestKind: preClassifiedKind } = input;

  const baseUrl = sourceUrl || getBaseUrl();
  const timeoutMs = getRequestTimeoutMs();
  const apiKey = getApiKeyForEndpoint(baseUrl);
  const client = getClient(baseUrl, timeoutMs, apiKey);

  const isThinkingModel = modelInfo.capabilities?.thinking ?? false;
  
  // Max tokens: per-model config (from modelOptions) overrides global setting
  // The picker sends string values ('0' = unlimited, '512', '4096', etc.)
  const modelConfig = (options as Record<string, unknown>).modelOptions || (options as Record<string, unknown>).modelConfiguration || {};
  const rawMaxTokens = (modelConfig as { maxTokens?: string | number }).maxTokens;
  // Convert to number — '0' or 0 means unlimited (omit max_tokens from request)
  const perModelMaxTokens = typeof rawMaxTokens === 'string' ? parseInt(rawMaxTokens, 10) : rawMaxTokens;
  const globalMaxTokens = getMaxTokens();
  // Use per-model if it's a positive number, else global, else undefined (unlimited)
  const maxTokens = (perModelMaxTokens && perModelMaxTokens > 0) ? perModelMaxTokens : globalMaxTokens;

  // Vision resolution
  const visionResolution = await resolveImageMessages(messages, token, getVisionDescriber);
  const resolvedMessages = visionResolution.messages;

  // Convert messages
  const convertedMessages = convertMessages(resolvedMessages, isThinkingModel);

  // Convert tools (handle readonly array from VS Code API)
  const tools = convertTools(options.tools ? [...options.tools] : undefined);

  // Count chars for adaptive token ratio
  const totalRequestChars = countMessageChars(convertedMessages);

  // Build base request
  const baseRequest: ChatCompletionRequest = {
    model: getApiModelId(modelInfo.id),
    messages: convertedMessages,
    stream: true,
    tools,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
    max_tokens: maxTokens,
  };

  // Use pre-classified request kind from index.ts, or classify here as fallback
  const requestKind: string = preClassifiedKind ?? classifyApiRequest({
    request: baseRequest,
    inputMessages: input.messages as unknown as { role: number; content: readonly { value?: string }[] }[],
  });

  // Thinking effort
  const configuredThinkingEffort = getConfiguredThinkingEffort(options);
  const forceNoneThinking = shouldForceThinkingNone(requestKind);
  const thinkingEffort = forceNoneThinking ? 'none' : configuredThinkingEffort;

  const request: ChatCompletionRequest = {
    ...baseRequest,
    ...(isThinkingModel
      ? {
          thinking: {
            type: thinkingEffort === 'none' ? 'disabled' : 'enabled',
          },
          ...(thinkingEffort === 'none' ? {} : { reasoning_effort: thinkingEffort }),
        }
      : {}),
  };

  // Collect trailing tool result IDs for diagnostics
  const trailingToolResultIds = collectTrailingToolResultIds(convertedMessages);

  if (forceNoneThinking) {
    logger.debug(
      formatRequestLogLine(requestKind, `Thinking disabled for helper task model=${modelInfo.id}`)
    );
  }

  return {
    client,
    request,
    isThinkingModel,
    totalRequestChars,
    requestKind,
    segment: '',
    replayMarkerMetadata: visionResolution.replayMarkerMetadata,
    visionMarkerTextChars: visionResolution.stats.markerVisionTextChars,
    initialResponseNotice: visionResolution.initialResponseNotice,
    trailingToolResultIds,
  };
}

/**
 * Collect tool call IDs from the last assistant message's tool results.
 */
function collectTrailingToolResultIds(
  messages: import('./convert').OpenAiMessage[]
): string[] {
  const ids: string[] = [];
  // Walk backwards to find tool result messages
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      ids.push(messages[i].tool_call_id ?? '');
    } else {
      break;
    }
  }
  return ids.reverse();
}

interface LoadedCacheEntry {
  confirmedAt: number;
  ttlMs: number;
}

/**
 * Cache of recently-confirmed-loaded models: `${baseUrl}::${modelId}` → entry.
 * Avoids redundant /v1/models polls when the model is already loaded.
 * - llama.cpp router (status present): TTL 30s — models can be evicted, so we
 *   re-check to detect eviction.
 * - Endpoints without a status field (Ollama, vLLM, cloud): TTL 5 min — models
 *   are always ready and can't be evicted, so re-polling frequently just pays
 *   server latency (e.g. z.ai /models ~400-600ms) for nothing.
 */
const loadedModelCache = new Map<string, LoadedCacheEntry>();
const LOADED_CACHE_TTL_MS = 30_000;
const ALWAYS_READY_CACHE_TTL_MS = 300_000;

/**
 * Verify the model is loaded on the server before sending a request.
 * Polls /v1/models with exponential backoff until the model loads or times out.
 *
 * Only polls when the endpoint returns a `status` field (llama.cpp router).
 * Ollama, vLLM, and other endpoints don't report status — models are always
 * ready, so we skip polling entirely and return immediately.
 * Uses a 30s cache to avoid redundant polls for already-loaded models.
 */
export async function waitForModelLoaded(
  baseUrl: string,
  modelId: string,
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>,
  token: vscode.CancellationToken,
  maxWaitMs: number = 120_000
): Promise<void> {
  // modelId is the source-unique picker ID (e.g. `qwen3.6:27b-gpu@llama-cpp`),
  // but /v1/models returns the plain API ID (e.g. `qwen3.6:27b-gpu`). Strip the
  // `@source` suffix so the find() below actually matches — otherwise the model
  // is never found and EVERY request spins in this poll loop for maxWaitMs.
  const apiModelId = getApiModelId(modelId);

  // Fast path: model was confirmed loaded recently
  const cacheKey = `${baseUrl}::${apiModelId}`;
  const cached = loadedModelCache.get(cacheKey);
  if (cached && Date.now() - cached.confirmedAt < cached.ttlMs) {
    return;
  }

  const startTime = Date.now();
  let pollInterval = 500; // Start with 500ms, back off to 5s max

  while (true) {
    if (token.isCancellationRequested) {
      return;
    }

    if (Date.now() - startTime > maxWaitMs) {
      logger.warn(`Model load wait timed out after ${maxWaitMs}ms for ${modelId}`);
      return; // Give up waiting, let the request attempt proceed
    }

    try {
      const controller = new AbortController();
      const pollTimeout = setTimeout(() => controller.abort(), 5000);
      // Send auth header when available — z.ai and other cloud APIs
      // return 401 without it, causing a 120s loop of useless retries.
      const apiKey = getApiKeyForEndpoint(baseUrl);
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        signal: controller.signal,
        ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
      });
      clearTimeout(pollTimeout);

      if (response.ok) {
        const data = await response.json();
        const model = (data.data as Array<{ id: string; status?: { value: string; failed?: boolean } }>)
          ?.find((m) => m.id === apiModelId);

        if (model) {
          // No status field — endpoint doesn't report load state (Ollama, vLLM,
          // cloud) — the model is always ready, proceed immediately. Cache with
          // a long TTL: these models can't be evicted, so re-polling frequently
          // just pays server latency (e.g. z.ai /models ~400-600ms) for nothing.
          if (!model.status) {
            loadedModelCache.set(cacheKey, { confirmedAt: Date.now(), ttlMs: ALWAYS_READY_CACHE_TTL_MS });
            return;
          }
          if (model.status.value === 'loaded') {
            loadedModelCache.set(cacheKey, { confirmedAt: Date.now(), ttlMs: LOADED_CACHE_TTL_MS });
            return; // Model is loaded, proceed
          }
          if (model.status.failed) {
            loadedModelCache.delete(cacheKey);
            throw new NonRetryableError(`Model '${modelId}' failed to load on the server. This usually means insufficient VRAM. Try stopping other models or use a smaller one. Restart your llama.cpp router to retry.`);
          }
          if (model.status.value === 'loading') {
            // Model is loading — report progress and keep polling.
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            progress.report(
              new vscode.LanguageModelTextPart(`⏳ Loading model... (${elapsed}s elapsed)\n\n`)
            );
          } else {
            // 'unloaded' (or any unknown status). Polling /v1/models will NEVER
            // start a load — only the chat request does. Dead-waiting here
            // delays every cold model by up to maxWaitMs (120s) BEFORE the
            // request is even sent, then the model still has to load.
            // Return immediately and let the chat request trigger the load.
            // Don't cache: the model isn't loaded yet.
            return;
          }
        } else if (Array.isArray(data.data)) {
          // Healthy response, but the model isn't listed at all (e.g. an
          // Ollama cold model not present in /v1/models, or an unknown ID).
          // Polling can't help here — proceed so the chat request triggers a
          // load or fails fast with a real error.
          return;
        }
      } else {
        // Non-OK response — log and break early on client errors (4xx)
        // to avoid 120s of useless retries
        logger.debug(`Model poll HTTP ${response.status} for ${modelId}`);
        if (response.status >= 400 && response.status < 500) {
          loadedModelCache.delete(cacheKey);
          return; // Client error — proceed to chat request, let it fail with a real error
        }
      }
    } catch (error) {
      // Non-retryable errors (model failed to load) must propagate immediately
      if (error instanceof NonRetryableError) throw error;
      if (error instanceof HttpError) {
        throw error; // Don't retry HTTP errors thrown by createHttpError
      }
      // Network errors during polling are expected — retry, but log for diagnostics
      logger.debug(`Model load poll retry for ${modelId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval * 1.5, 5000);
  }
}
