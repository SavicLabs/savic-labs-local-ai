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

  constructor(baseUrl: string) {
    // Strip trailing slash for clean URL joining
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Stream a chat completion from the API endpoint.
   * Parses SSE chunks and dispatches callbacks for content, thinking, and tool calls.
   */
  async streamChatCompletion(
    request: ChatCompletionRequest,
    callbacks: StreamCallbacks,
    cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose(): void } }
  ): Promise<void> {
    const controller = new AbortController();
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

      // Accumulate tool call deltas by index
      const pendingToolCalls = new Map<number, ToolCall>();

      while (true) {
        if (cancellationToken?.isCancellationRequested) {
          controller.abort();
          return;
        }

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
              callbacks.onThinking(reasoning);
            }

            // Regular content
            if (choice.delta?.content) {
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
      if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
        return;
      }
      const normalizedError = normalizeRequestError(error, { baseUrl: this.baseUrl, request });
      callbacks.onError(normalizedError);
    } finally {
      cancelListener?.dispose();
    }
  }
}

function reportFinalUsage(callbacks: StreamCallbacks, usage: Usage | undefined): void {
  if (usage) {
    callbacks.onUsage(usage);
  }
}
