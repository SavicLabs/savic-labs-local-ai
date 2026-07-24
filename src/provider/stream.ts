/**
 * Stream handler — wires SSE callbacks to VS Code progress reporting.
 */
import * as vscode from 'vscode';
import { createUserFacingError } from '../client';
import type { Usage } from '../client/core';
import type { PreparedRequest } from './request';
import { createReplayMarkerPart, hasReplayMarkerMetadata } from './replay/markers';
import { updateCharsPerToken } from './tokens';
import { formatRequestLogLine } from './routing/classifier';
import { logger } from '../logger';

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

interface StreamState {
  accumulatedReasoning: string;
  emittedToolCallIds: string[];
  initialResponseNoticeReported: boolean;
  replayMarkerReported: boolean;
}

export async function streamChatCompletion(params: {
  prepared: PreparedRequest;
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>;
  token: vscode.CancellationToken;
  getCharsPerToken: () => number;
  setCharsPerToken: (ratio: number) => void;
}): Promise<void> {
  const { prepared, progress, token, getCharsPerToken, setCharsPerToken } = params;

  const state: StreamState = {
    accumulatedReasoning: '',
    emittedToolCallIds: [],
    initialResponseNoticeReported: false,
    replayMarkerReported: false,
  };

  const cancelListener = token.onCancellationRequested(() => {
    // No-op — cancellation is handled by the client's AbortController
  });

  try {
    await prepared.client.streamChatCompletion(
      prepared.request,
      {
        onContent: (content: string) => {
          reportInitialResponseNoticeOnce(progress, state, prepared.initialResponseNotice);
          progress.report(new vscode.LanguageModelTextPart(content));
        },
        onThinking: (text: string) => {
          reportInitialResponseNoticeOnce(progress, state, prepared.initialResponseNotice);
          handleThinking(text, state, progress);
        },
        onToolCall: (toolCall) => {
          reportInitialResponseNoticeOnce(progress, state, prepared.initialResponseNotice);
          handleToolCall(toolCall, state, progress);
        },
        onUsage: (usage: Usage) => {
          const charsPerToken = updateCharsPerToken(
            prepared.totalRequestChars,
            usage.prompt_tokens,
            getCharsPerToken()
          );
          setCharsPerToken(charsPerToken);
          reportCopilotContextUsage(progress, usage, prepared.requestKind);
        },
        onError: (error: Error) => {
          throw createUserFacingError(error);
        },
        onDone: () => {
          reportReplayMarkerOnce(prepared, progress, state);
        },
      },
      token
    );
  } catch (error) {
    if (token.isCancellationRequested) {
      return;
    }
    throw error;
  } finally {
    cancelListener.dispose();
  }
}

function reportInitialResponseNoticeOnce(
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>,
  state: StreamState,
  initialResponseNotice?: string
): void {
  if (!initialResponseNotice || state.initialResponseNoticeReported) {
    return;
  }
  state.initialResponseNoticeReported = true;
  progress.report(new vscode.LanguageModelTextPart(initialResponseNotice));
}

function reportReplayMarkerOnce(
  prepared: PreparedRequest,
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>,
  state: StreamState
): void {
  if (state.replayMarkerReported) {
    return;
  }
  state.replayMarkerReported = true;

  const metadata = {
    ...prepared.replayMarkerMetadata,
    reasoningText: state.accumulatedReasoning || undefined,
  };

  if (!hasReplayMarkerMetadata(metadata)) {
    return;
  }

  try {
    const markerPart = createReplayMarkerPart(metadata);
    progress.report(markerPart);
  } catch (error) {
    logger.warn(
      formatRequestLogLine(prepared.requestKind, 'Failed to report replay marker'),
      error
    );
  }
}

function handleThinking(
  text: string,
  state: StreamState,
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>
): void {
  state.accumulatedReasoning += text;
  progress.report(new vscode.LanguageModelThinkingPart(text));
}

function handleToolCall(
  toolCall: { id: string; function: { name: string; arguments: string } },
  state: StreamState,
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>
): void {
  state.emittedToolCallIds.push(toolCall.id);
  try {
    const args = JSON.parse(toolCall.function.arguments);
    progress.report(
      new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args)
    );
  } catch {
    progress.report(
      new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {})
    );
  }
}

function reportCopilotContextUsage(
  progress: vscode.Progress<vscode.LanguageModelChatResponsePart>,
  usage: Usage,
  requestKind: string
): void {
  const data = {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    prompt_tokens_details: {
      cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
    },
  };

  try {
    progress.report(
      new vscode.LanguageModelDataPart(
        new TextEncoder().encode(JSON.stringify(data)),
        COPILOT_USAGE_DATA_PART_MIME
      )
    );
  } catch (error) {
    logger.warn(
      formatRequestLogLine(requestKind, 'Failed to report usage data'),
      error
    );
  }
}
