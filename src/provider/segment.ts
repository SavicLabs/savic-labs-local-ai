/**
 * Conversation segment UUID tracking.
 * Extracts a stable segment ID from messages to correlate request diagnostics.
 */
import * as vscode from 'vscode';

/**
 * Extract a conversation segment identifier from the message list.
 * Uses the first 8 chars of a hash of the first system message content.
 */
export function resolveConversationSegment(
  messages: vscode.LanguageModelChatMessage[]
): string {
  // Find first user message and hash it
  for (const msg of messages) {
    if (msg.role === vscode.LanguageModelChatMessageRole.User) {
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          return simpleHash(part.value).slice(0, 8);
        }
      }
    }
  }
  return 'unknown';
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
