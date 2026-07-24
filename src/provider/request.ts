/**
 * Request preparation — assembles the full chat completion request body.
 */
import * as vscode from 'vscode';
import { SavicLabsClient, createUserFacingError } from '../client';
import type { ChatCompletionRequest } from '../client/core';
import { getBaseUrl, getApiModelId, getMaxTokens, getRequestTimeoutMs } from '../config';
import { convertMessages, convertTools, countMessageChars } from './convert';
import { getConfiguredThinkingEffort } from './models';
import { classifyApiRequest, shouldForceThinkingNone, formatRequestLogLine } from './routing/classifier';
import { resolveImageMessages } from './vision/resolve';
import type { VisionDescriber } from './vision/service';
import { logger } from '../logger';
import { HttpError } from '../client/error';

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
}

export async function prepareChatRequest(input: PrepareRequestInput): Promise<PreparedRequest> {
  const { modelInfo, messages, options, token, getVisionDescriber, sourceUrl } = input;

  const baseUrl = sourceUrl || getBaseUrl();
  const timeoutMs = getRequestTimeoutMs();
  const client = new SavicLabsClient(baseUrl, timeoutMs);

  const isThinkingModel = modelInfo.capabilities?.thinking ?? false;
  
  // Max tokens: per-model config (from modelOptions) overrides global setting
  const modelConfig = (options as Record<string, unknown>).modelOptions || (options as Record<string, unknown>).modelConfiguration || {};
  const perModelMaxTokens = (modelConfig as { maxTokens?: number }).maxTokens;
  const maxTokens = perModelMaxTokens ?? getMaxTokens();

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

  // Classify request
  const requestKind = classifyApiRequest({
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

/**
 * Verify the model is loaded on the server before sending a request.
 * Polls /v1/models with exponential backoff until the model loads or times out.
 */
export async function waitForModelLoaded(
  baseUrl: string,
  modelId: string,
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>,
  token: vscode.CancellationToken,
  maxWaitMs: number = 60_000
): Promise<void> {
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
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        signal: controller.signal,
      });
      clearTimeout(pollTimeout);

      if (response.ok) {
        const data = await response.json();
        const model = (data.data as Array<{ id: string; status?: { value: string; failed?: boolean } }>)
          ?.find((m) => m.id === modelId);

        if (model) {
          if (model.status?.value === 'loaded') {
            return; // Model is loaded, proceed
          }
          if (model.status?.failed) {
            throw new Error(`Model '${modelId}' failed to load on the server. Restart your llama.cpp router.`);
          }
          if (model.status?.value === 'loading') {
            // Model is loading — report progress
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            progress.report(
              new vscode.LanguageModelTextPart(`⏳ Loading model... (${elapsed}s elapsed)\n\n`)
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error; // Don't retry HTTP errors
      }
      // Network errors during polling are expected — retry
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval * 1.5, 5000);
  }
}
