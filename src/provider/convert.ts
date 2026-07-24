/**
 * Convert VS Code chat messages to OpenAI-compatible format.
 * Handles text, thinking content, tool calls, and tool results.
 */
import * as vscode from 'vscode';
import { safeStringify } from '../json';
import { parseFirstReplayMarker } from './replay/markers';
import type { ReplayMarkerParsed } from './replay/markers';
import { REPLAY_MARKER_MIME } from './replay/consts';

export interface OpenAiMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert VS Code chat messages to OpenAI format.
 * Injects marker-replayed reasoning_content for assistant messages.
 */
export function convertMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  isThinkingModel: boolean
): OpenAiMessage[] {
  const result: OpenAiMessage[] = [];

  for (const message of messages) {
    const role = mapRole(message.role);
    let content = '';
    let thinkingContent = '';
    const toolCalls: OpenAiToolCall[] = [];
    const toolResults: ToolResultItem[] = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        content += part.value;
      } else if (isLanguageModelThinkingPart(part)) {
        thinkingContent += normalizeThinkingPartText((part as unknown as { value: string | string[] }).value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: safeStringify(part.input),
          },
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        let toolContent = '';
        for (const item of part.content) {
          if (item instanceof vscode.LanguageModelTextPart) {
            toolContent += item.value;
          }
        }
        toolResults.push({
          callId: part.callId,
          content: toolContent || safeStringify(part.content),
        });
      }
    }

    if (role === 'assistant') {
      if (content || toolCalls.length > 0) {
        const replayMarker = isThinkingModel
          ? parseFirstReplayMarker(message)
          : undefined;

        const msg: OpenAiMessage = {
          role: 'assistant',
          content: content || null,
        };

        if (toolCalls.length > 0) {
          msg.tool_calls = toolCalls;
        }

        if (isThinkingModel) {
          msg.reasoning_content = getReasoningContent(replayMarker, thinkingContent);
        }

        result.push(msg);
      }
    } else {
      if (content) {
        result.push({
          role,
          content,
        });
      }
    }

    // Tool result messages follow their associated assistant message
    for (const tr of toolResults) {
      result.push({
        role: 'tool',
        content: tr.content,
        tool_call_id: tr.callId,
      });
    }
  }

  return result;
}

/**
 * Convert VS Code tool definitions to OpenAI format.
 */
export function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined
): OpenAiTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    },
  }));
}

/**
 * Count total characters across all converted messages.
 */
export function countMessageChars(messages: OpenAiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += msg.content?.length ?? 0;
    total += msg.reasoning_content?.length ?? 0;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += tc.function.name?.length ?? 0;
        total += tc.function.arguments?.length ?? 0;
      }
    }
  }
  return total;
}

// ---- Internal helpers ----

interface ToolResultItem {
  callId: string;
  content: string;
}

function getReasoningContent(
  replayMarker: ReplayMarkerParsed | undefined,
  thinkingContent: string
): string | undefined {
  if (replayMarker?.valid && replayMarker.reasoningText) {
    return replayMarker.reasoningText;
  }
  return thinkingContent || undefined;
}

function isLanguageModelThinkingPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }
  // Duck-type check: LanguageModelThinkingPart has a 'value' property
  // but is not one of the known VS Code content part classes
  const p = part as Record<string, unknown>;
  return (
    p.value !== undefined &&
    p.callId === undefined &&
    p.mimeType === undefined &&
    !(part instanceof vscode.LanguageModelTextPart) &&
    !(part instanceof vscode.LanguageModelToolCallPart) &&
    !(part instanceof vscode.LanguageModelToolResultPart) &&
    !(part instanceof vscode.LanguageModelDataPart)
  );
}

function normalizeThinkingPartText(value: string | string[]): string {
  return Array.isArray(value) ? value.join('') : String(value);
}

function mapRole(role: vscode.LanguageModelChatMessageRole): OpenAiMessage['role'] {
  switch (role) {
    case vscode.LanguageModelChatMessageRole.User:
      return 'user';
    case vscode.LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    default:
      return 'user';
  }
}

// Re-export for use in convert module
export { REPLAY_MARKER_MIME };
