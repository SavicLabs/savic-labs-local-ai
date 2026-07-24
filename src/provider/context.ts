/**
 * Context Window Manager — prevents context-overflow crashes.
 *
 * Responsibilities:
 * 1. Estimate total prompt tokens before sending (chars-per-token ratio)
 * 2. Detect when context exceeds model's maxInputTokens
 * 3. Intelligent truncation: preserves system prompt, tool chains, recent messages
 * 4. Track running context usage across conversation turns
 * 5. Warn user at 75% and 90% thresholds
 */
import * as vscode from 'vscode';
import { estimateTokenCount } from './tokens';

export interface ContextCheckResult {
  /** Whether truncation was needed. */
  truncated: boolean;
  /** The (possibly truncated) messages to send. */
  messages: vscode.LanguageModelChatMessage[];
  /** Notice to show the user about what happened. */
  notice?: string;
  /** Estimated prompt tokens being sent. */
  estimatedTokens: number;
  /** Model's max context window. */
  maxContextTokens: number;
  /** Usage percentage (0-100). */
  usagePercent: number;
}

/**
 * Check if messages fit within the model's context window.
 * If not, intelligently truncate while preserving critical messages.
 */
export function checkContextWindow(
  messages: vscode.LanguageModelChatMessage[],
  maxInputTokens: number,
  charsPerToken: number,
  /** Reserve this many tokens for the response (default 1024). */
  reserveTokens: number = 1024
): ContextCheckResult {
  const effectiveMax = maxInputTokens - reserveTokens;

  // Estimate total tokens
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += getMessageChars(msg);
  }
  const estimatedTokens = estimateTokenCount(String(totalChars), charsPerToken);
  const usagePercent = Math.round((estimatedTokens / effectiveMax) * 100);

  // If we're under the limit, no truncation needed
  if (estimatedTokens <= effectiveMax) {
    // Still warn at high usage
    let notice: string | undefined;
    if (usagePercent > 90) {
      notice = `⚠️ Context ${usagePercent}% full (${estimatedTokens}/${effectiveMax} tokens). Consider starting a new conversation.`;
    } else if (usagePercent > 75) {
      notice = `📊 Context ${usagePercent}% full.`;
    }
    return {
      truncated: false,
      messages,
      notice,
      estimatedTokens,
      maxContextTokens: maxInputTokens,
      usagePercent,
    };
  }

  // Context exceeded — truncate
  const truncated = truncateMessages(messages, effectiveMax, charsPerToken);

  return {
    truncated: true,
    messages: truncated.messages,
    notice: `⚠️ Context window exceeded. Dropped ${truncated.droppedCount} earlier messages to fit ${truncated.estimatedTokens}/${effectiveMax} tokens.`,
    estimatedTokens: truncated.estimatedTokens,
    maxContextTokens: maxInputTokens,
    usagePercent: Math.round((truncated.estimatedTokens / effectiveMax) * 100),
  };
}

interface TruncationResult {
  messages: vscode.LanguageModelChatMessage[];
  droppedCount: number;
  estimatedTokens: number;
}

/**
 * Intelligently truncate messages to fit within the token budget.
 *
 * Strategy:
 * 1. Always keep the first message (system prompt)
 * 2. Keep the last N message pairs (user + assistant + tool results)
 * 3. Preserve tool call chains (don't split tool call from its result)
 * 4. Drop oldest messages first
 */
function truncateMessages(
  messages: vscode.LanguageModelChatMessage[],
  maxTokens: number,
  charsPerToken: number
): TruncationResult {
  if (messages.length <= 2) {
    // Can't truncate further — return as-is with a note
    return {
      messages,
      droppedCount: 0,
      estimatedTokens: estimateTokenCount(
        String(messages.reduce((sum, m) => sum + getMessageChars(m), 0)),
        charsPerToken
      ),
    };
  }

  // Always keep the first message (system prompt / initial context)
  const systemMsg = messages[0];
  let systemChars = getMessageChars(systemMsg);

  // Walk backwards from the end, keeping messages until we hit the budget
  const kept: vscode.LanguageModelChatMessage[] = [];
  let keptChars = 0;
  let pendingToolResults: vscode.LanguageModelChatMessage[] = [];

  for (let i = messages.length - 1; i >= 1; i--) {
    const msg = messages[i];

    // Tool result messages must stay with their preceding assistant tool call
    if (isToolResultMessage(msg)) {
      pendingToolResults.push(msg);
      continue;
    }

    const msgChars = getMessageChars(msg);
    const pendingChars = pendingToolResults.reduce(
      (sum, m) => sum + getMessageChars(m),
      0
    );

    if (systemChars + keptChars + msgChars + pendingChars > maxTokens) {
      // Can't fit this message — stop here
      break;
    }

    // Add the message and any pending tool results
    kept.unshift(msg);
    keptChars += msgChars;

    for (const tr of pendingToolResults.reverse()) {
      kept.push(tr);
      keptChars += getMessageChars(tr);
    }
    pendingToolResults = [];
  }

  // Build final result: system message + kept messages
  const result = [systemMsg, ...kept];
  const droppedCount = messages.length - result.length;

  return {
    messages: result,
    droppedCount,
    estimatedTokens: estimateTokenCount(String(systemChars + keptChars), charsPerToken),
  };
}

/**
 * Get the total character count of a message's content.
 */
function getMessageChars(msg: vscode.LanguageModelChatMessage): number {
  let chars = 0;
  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      chars += part.value.length;
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      chars += part.name.length + JSON.stringify(part.input).length;
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      for (const item of part.content) {
        if (item instanceof vscode.LanguageModelTextPart) {
          chars += item.value.length;
        }
      }
    } else if (part instanceof vscode.LanguageModelDataPart) {
      chars += part.data.byteLength; // Rough estimate for binary data
    }
    // LanguageModelThinkingPart (proposed API) — use duck typing
    const thinkingPart = part as { value?: string | string[] };
    if (thinkingPart.value !== undefined) {
      const v = thinkingPart.value;
      chars += Array.isArray(v) ? v.join('').length : String(v).length;
    }
  }
  return chars;
}

/**
 * Check if a message is a tool result (needs to stay with its preceding tool call).
 */
function isToolResultMessage(msg: vscode.LanguageModelChatMessage): boolean {
  return msg.role === vscode.LanguageModelChatMessageRole.User &&
    Array.from(msg.content).some((p) => p instanceof vscode.LanguageModelToolResultPart);
}
