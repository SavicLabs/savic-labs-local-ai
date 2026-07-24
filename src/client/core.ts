/**
 * Lightweight SSE-streaming OpenAI-compatible API client.
 * No external dependencies — uses Node's built-in fetch.
 *
 * Connects to llama.cpp router (or any OpenAI-compatible endpoint).
 * No auth needed for local servers.
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

  constructor(baseUrl: string, timeoutMs: number = 120_000, maxRetries: number = 2) {
    // Strip trailing slash for clean URL joining
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
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
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (cancellationToken?.isCancellationRequested) {
        return;
      }

      try {
        await this.streamChatCompletionOnce(request, callbacks, cancellationToken, (timer) => { stallTimer = timer; });
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) or user cancellation
        if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
          return;
        }

        if (isHttpStatus(error, 400, 499)) {
          break; // Client error, don't retry
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
      } finally {
        if (stallTimer) {
          clearTimeout(stallTimer);
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
    cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose(): void } },
    setStallTimer?: (timer: ReturnType<typeof setTimeout>) => void
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      logger.warn(`Request timed out after ${this.timeoutMs}ms for model ${request.model}`);
    }, this.timeoutMs);

    const cancelListener = cancellationToken?.onCancellationRequested(() => {
      controller.abort();
    });

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
        headers: {
          'Content-Type': 'application/json',
        },
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
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      let firstTokenReceived = false;

      // Accumulate tool call deltas by index
      const pendingToolCalls = new Map<number, ToolCall>();

      while (true) {
        if (cancellationToken?.isCancellationRequested) {
          controller.abort();
          return;
        }

        // Stall detection: 120s for first token (prompt eval), 60s after
        if (stallTimer) clearTimeout(stallTimer);
        const stallMs = firstTokenReceived ? 60_000 : 120_000;
        stallTimer = setTimeout(() => {
          logger.warn(`Stream stalled (${stallMs / 1000}s no data) for model ${request.model}`);
          controller.abort();
        }, stallMs);
        if (setStallTimer) setStallTimer(stallTimer);

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

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

          if (!trimmed.startsWith('data: ')) {
            continue;
          }

          const jsonStr = trimmed.slice(6);
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
                let pending = pendingToolCalls.get(tc.index);
                if (!pending && tc.id) {
                  pending = {
                    id: tc.id,
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                  pendingToolCalls.set(tc.index, pending);
                }
                if (pending) {
                  if (tc.function?.name) {
                    pending.function.name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    pending.function.arguments += tc.function.arguments;
                  }
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
