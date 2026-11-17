/**
 * Context Window Guard.
 *
 * The chat host owns conversation compaction: it sizes prompts through
 * `provideTokenCount` and summarizes the history when the window fills. This
 * module is only a last-resort preflight check, so an oversized prompt fails
 * with a clear error instead of being forwarded to the model server.
 *
 * It deliberately does NOT rewrite history. Dropping messages here would send
 * the host a different conversation than the one it rendered and sized, and
 * splitting assistant tool calls from their results produces invalid prompts.
 */
import * as vscode from 'vscode';
import { estimateTokenCount } from './tokens';

export interface ContextUsage {
  /** Estimated prompt tokens, including extra content (e.g. tool definitions). */
  estimatedTokens: number;
  /** Budget the prompt must fit into (context window minus response reserve). */
  maxContextTokens: number;
  /** The model's full context window. */
  contextWindowTokens: number;
  /** 0-100: estimatedTokens / maxContextTokens. */
  usagePercent: number;
  /** Whether the prompt fits within the budget. */
  fits: boolean;
}

export interface ContextUsageOptions {
  /** Reserve this many tokens for the response (default 4096). */
  reserveTokens?: number;
  /** Characters sent outside `messages` (tool definitions, etc.). */
  extraChars?: number;
}

/**
 * Measure a prompt against the model's context window.
 */
export function measureContextUsage(
  messages: readonly vscode.LanguageModelChatMessage[],
  contextWindowTokens: number,
  charsPerToken: number,
  options: ContextUsageOptions = {}
): ContextUsage {
  const reserveTokens = options.reserveTokens ?? 4096;
  const maxContextTokens = Math.max(1, contextWindowTokens - reserveTokens);

  let estimatedTokens = 0;
  for (const message of messages) {
    estimatedTokens += estimateTokenCount(message, charsPerToken);
  }

  if (options.extraChars && options.extraChars > 0) {
    estimatedTokens += Math.max(1, Math.ceil(options.extraChars / charsPerToken));
  }

  return {
    estimatedTokens,
    maxContextTokens,
    contextWindowTokens,
    usagePercent: Math.round((estimatedTokens / maxContextTokens) * 100),
    fits: estimatedTokens <= maxContextTokens,
  };
}

/** Thrown when a prompt cannot fit the model's context window. */
export class ContextOverflowError extends Error {
  readonly usage: ContextUsage;

  constructor(modelName: string, usage: ContextUsage) {
    super(
      `Conversation exceeds the context window of '${modelName}' ` +
      `(estimated ${usage.estimatedTokens}/${usage.maxContextTokens} tokens). ` +
      'Start a new chat or run "Compact Conversation" to continue.'
    );
    this.name = 'ContextOverflowError';
    this.usage = usage;
  }
}
