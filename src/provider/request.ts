/**
 * Request preparation — assembles the full chat completion request body.
 */
import * as vscode from 'vscode';
import { SavicLabsClient, createUserFacingError } from '../client';
import type { ChatCompletionRequest } from '../client/core';
import { getBaseUrl, getApiModelId, getMaxTokens } from '../config';
import { convertMessages, convertTools, countMessageChars } from './convert';
import { getConfiguredThinkingEffort } from './models';
import { classifyDeepSeekRequest, shouldForceThinkingNone, formatRequestLogLine } from './routing/classifier';
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
}

export async function prepareChatRequest(input: PrepareRequestInput): Promise<PreparedRequest> {
  const { modelInfo, messages, options, token, getVisionDescriber } = input;

  const baseUrl = getBaseUrl();
  const client = new SavicLabsClient(baseUrl);

  const isThinkingModel = modelInfo.capabilities?.thinking ?? false;
  const maxTokens = getMaxTokens();

  // Vision resolution
  const visionResolution = await resolveImageMessages(messages, token, getVisionDescriber);
  const resolvedMessages = visionResolution.messages;

  // Convert messages
  const deepseekMessages = convertMessages(resolvedMessages, isThinkingModel);

  // Convert tools (handle readonly array from VS Code API)
  const tools = convertTools(options.tools ? [...options.tools] : undefined);

  // Count chars for adaptive token ratio
  const totalRequestChars = countMessageChars(deepseekMessages);

  // Build base request
  const baseRequest: ChatCompletionRequest = {
    model: getApiModelId(modelInfo.id),
    messages: deepseekMessages,
    stream: true,
    tools,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
    max_tokens: maxTokens,
  };

  // Classify request
  const requestKind = classifyDeepSeekRequest({
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
  const trailingToolResultIds = collectTrailingToolResultIds(deepseekMessages);

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
