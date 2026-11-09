/**
 * Lightweight SSE-streaming OpenAI-compatible API client.
 * No external dependencies — uses Node's built-in fetch.
 *
 * Connects to llama.cpp router (or any OpenAI-compatible endpoint).
 * Supports optional Bearer token auth for cloud providers (z.ai, OpenRouter, etc.).
 */
import { safeStringify } from '../json';
import { logger } from '../logger';
import { createHttpError, normalizeRequestError, isAbortError } from './error';

/** Callbacks invoked during SSE streaming. */
export interface StreamCallbacks {
  onContent(content: string): void;
  onThinking(text: string): void;
  onToolCall(toolCall: ToolCall): void;
  onUsage(usage: Usage): void;
  onError(error: Error): void;
  onDone(): void;
  /** Model loading progress (0-100, only if model needs loading). */
  onLoadProgress?: (percent: number) => void;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  /** z.ai / OpenAI format: nested cache token count. */
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface ChatCompletionRequest {
  model: string;
  messages: unknown[];
  stream: true;
  stream_options?: { include_usage: boolean };
  tools?: unknown[];
  tool_choice?: 'auto' | 'required' | 'none';
  max_tokens?: number;
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'none' | 'high' | 'max';
}

export class SavicLabsClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly apiKey?: string;

  constructor(baseUrl: string, timeoutMs: number = 120_000, maxRetries: number = 2, apiKey?: string) {
    // Strip trailing slash for clean URL joining
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.apiKey = apiKey?.trim() || undefined;
  }

  /** Build headers, including Authorization when an API key is configured. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Stream a chat completion from the API endpoint.
   * Includes timeout, retry on transient errors, and model load progress.
   */
  async streamChatCompletion(
    request: ChatCompletionRequest,
    callbacks: StreamCallbacks,
    cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose(): void } }
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (cancellationToken?.isCancellationRequested) {
        return;
      }

      try {
        await this.streamChatCompletionOnce(request, callbacks, cancellationToken);
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) or user cancellation,
        // EXCEPT 429 (rate limit / service overloaded) which is transient
        // for cloud providers (z.ai, Verboo) and is handled by isRetryable.
        if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
          return;
        }

        if (isHttpStatus(error, 400, 499) && !isHttpStatus(error, 429, 429)) {
          break; // Client error, don't retry
        }

        // Non-retryable errors (model failed to load, etc.) — surface immediately
        if (error instanceof Error && error.name === 'NonRetryableError') {
          break;
        }

        if (!isAbortError(error) && !isRetryable(error)) {
          break; // Non-retryable error
        }

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          logger.info(
            `Retry ${attempt + 1}/${this.maxRetries} after ${delay}ms: ${lastError.message.slice(0, 100)}`
          );
          await sleep(delay);
        }
      }
    }

    // All retries exhausted
    callbacks.onError(lastError || new Error('Unknown error'));
  }
  /**
   * Single attempt at streaming (no retry).
   */
  private async streamChatCompletionOnce(
    request: ChatCompletionRequest,
    callbacks: StreamCallbacks,
    cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose(): void } }
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      logger.warn(`Request timed out after ${this.timeoutMs}ms for model ${request.model}`);
    }, this.timeoutMs);

    const cancelListener = cancellationToken?.onCancellationRequested(() => {
      controller.abort();
    });

    let stallCheckInterval: ReturnType<typeof setTimeout> | undefined;

    if (cancellationToken?.isCancellationRequested) {
      controller.abort();
    }

    try {
      const requestBody = {
        ...request,
        stream: true as const,
        stream_options: { include_usage: true },
      };

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: safeStringify(requestBody),
        signal: controller.signal,
      });

      // Clear the timeout — we got a response
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await createHttpError(response, { baseUrl: this.baseUrl, request });
      }

      if (!response.body) {
        throw new Error('No response body received');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let latestUsage: Usage | undefined;
      let firstTokenReceived = false;

      // Accumulate tool call deltas by index
      const pendingToolCalls = new Map<number, ToolCall>();

      // Stall detection using a single interval timer + timestamp.
      // This avoids creating/destroying a timer on every SSE chunk.
      let lastChunkTime = Date.now();
      const stallCheck = () => {
        const stallMs = firstTokenReceived ? 60_000 : 120_000;
        if (Date.now() - lastChunkTime > stallMs) {
          logger.warn(`Stream stalled (${stallMs / 1000}s no data) for model ${request.model}`);
          controller.abort();
          return;
        }
        stallCheckInterval = setTimeout(stallCheck, 5_000);
      };
      stallCheckInterval = setTimeout(stallCheck, 5_000);

      while (true) {
        if (cancellationToken?.isCancellationRequested) {
          controller.abort();
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        // Update chunk timestamp for stall detection
        lastChunkTime = Date.now();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) {
            continue;
          }

          if (trimmed === 'data: [DONE]') {
            // Flush any remaining tool calls
            for (const tc of pendingToolCalls.values()) {
              callbacks.onToolCall(tc);
            }
            pendingToolCalls.clear();
            reportFinalUsage(callbacks, latestUsage);
            callbacks.onDone();
            return;
          }

          // Parse SSE data — handle both "data: " (with space) and "data:" (without)
          let jsonStr: string | null = null;
          if (trimmed.startsWith('data: ')) {
            jsonStr = trimmed.slice(6);
          } else if (trimmed.startsWith('data:')) {
            jsonStr = trimmed.slice(5);
          }
          if (jsonStr === null) {
            continue;
          }
          try {
            const chunk = JSON.parse(jsonStr);

            // Handle error chunks
            if (chunk.error) {
              const errMsg = chunk.error.message || safeStringify(chunk.error);
              callbacks.onContent(`\n[Server error: ${errMsg}]\n`);
              continue;
            }

            const choice = chunk.choices?.[0];

            // Capture usage from chunk
            if (chunk.usage) {
              latestUsage = chunk.usage;
            }

            if (!choice) {
              continue;
            }

            // Thinking/reasoning content
            const reasoning = choice.delta?.reasoning_content;
            if (reasoning) {
              firstTokenReceived = true;
              callbacks.onThinking(reasoning);
            }

            // Regular content
            if (choice.delta?.content) {
              firstTokenReceived = true;
              callbacks.onContent(choice.delta.content);
            }

            // Tool calls — accumulate deltas by index
            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = typeof tc.index === 'number' ? tc.index : 0;
                let pending = pendingToolCalls.get(idx);
                if (!pending) {
                  // Create entry on first sight of this index, even without id.
                  // Some servers defer id to a later delta.
                  pending = {
                    id: tc.id ?? `call_${idx}_${Date.now()}`,
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                  pendingToolCalls.set(idx, pending);
                }
                // Update id if a real one arrives later
                if (tc.id && pending.id.startsWith('call_')) {
                  pending.id = tc.id;
                }
                if (tc.function?.name) {
                  pending.function.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  pending.function.arguments += tc.function.arguments;
                }
              }
            }

            // Flush pending tool calls on finish
            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              for (const tc of pendingToolCalls.values()) {
                callbacks.onToolCall(tc);
              }
              pendingToolCalls.clear();
            }
          } catch (e) {
            logger.error('Failed to parse SSE chunk:', jsonStr.slice(0, 200), e);
          }
        }
      }

      // Stream ended without [DONE]
      reportFinalUsage(callbacks, latestUsage);
      callbacks.onDone();
    } catch (error) {
      clearTimeout(timeoutId);
      if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
        return;
      }
      throw normalizeRequestError(error, { baseUrl: this.baseUrl, request });
    } finally {
      clearTimeout(timeoutId);
      if (stallCheckInterval) clearTimeout(stallCheckInterval);
      cancelListener?.dispose();
    }
  }
}

function reportFinalUsage(callbacks: StreamCallbacks, usage: Usage | undefined): void {
  if (usage) {
    callbacks.onUsage(usage);
  }
}

/** Check if an error is an HTTP error with a status in the given range. */
function isHttpStatus(error: unknown, min: number, max: number): boolean {
  const err = error as { statusCode?: number };
  return typeof err.statusCode === 'number' && err.statusCode >= min && err.statusCode <= max;
}

/** Check if an error is retryable (server errors, network errors). */
function isRetryable(error: unknown): boolean {
  if (isHttpStatus(error, 500, 599)) return true;
  if (isHttpStatus(error, 429, 429)) return true; // Rate limit
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed')
  );
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
