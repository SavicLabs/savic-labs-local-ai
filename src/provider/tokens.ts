/**
 * Token estimation with adaptive calibration.
 *
 * Uses a chars-per-token ratio that is calibrated via exponential moving
 * average whenever real usage data is reported by the API.
 *
 * `estimateTokenCount` accounts for *every* content-part type, not just text.
 * The chat host calls this (through `provideTokenCount`) to size prompts and to
 * decide when to compact a conversation. Counting tool results as zero makes a
 * 200K-token agent session look nearly empty, so the host never compacts.
 */
import * as vscode from 'vscode';
import { REPLAY_MARKER_MIME } from './replay/consts';

/** Fixed token cost for an image attachment. */
const IMAGE_PART_FIXED_TOKENS = 384;

/** Documents and other binary parts: cap so one attachment can't dominate. */
const MAX_DATA_PART_CHARS = 10_000;

/** Character / fixed-token split for a single content part. */
interface PartEstimate {
  textChars: number;
  fixedTokens: number;
}

/** Estimate the text characters and fixed token cost of one content part. */
function estimatePart(part: unknown): PartEstimate {
  if (part instanceof vscode.LanguageModelTextPart) {
    return { textChars: part.value.length, fixedTokens: 0 };
  }

  if (part instanceof vscode.LanguageModelToolCallPart) {
    let chars = part.callId.length + part.name.length;
    try {
      chars += JSON.stringify(part.input).length;
    } catch {
      chars += 2; // circular or otherwise non-serializable input
    }
    return { textChars: chars, fixedTokens: 0 };
  }

  if (part instanceof vscode.LanguageModelToolResultPart) {
    let textChars = part.callId.length;
    let fixedTokens = 0;
    for (const item of part.content ?? []) {
      const nested = estimatePart(item);
      textChars += nested.textChars;
      fixedTokens += nested.fixedTokens;
    }
    return { textChars, fixedTokens };
  }

  if (part instanceof vscode.LanguageModelDataPart) {
    const mime = part.mimeType ?? '';
    if (mime === REPLAY_MARKER_MIME) {
      // Replay markers are re-sent as `reasoning_content`, so their payload
      // occupies context — charge for the encoded bytes.
      return { textChars: part.data?.byteLength ?? 0, fixedTokens: 0 };
    }
    if (mime.startsWith('image/')) {
      // Images are resolved to text descriptions by the vision pipeline. Keep
      // the estimate independent of charsPerToken so it can't distort
      // calibration.
      return { textChars: 0, fixedTokens: IMAGE_PART_FIXED_TOKENS };
    }
    return {
      textChars: Math.min(part.data?.byteLength ?? 0, MAX_DATA_PART_CHARS),
      fixedTokens: 0,
    };
  }

  const thinking = part as { value?: string | string[] };
  if (isLanguageModelThinkingPart(part) && thinking.value !== undefined) {
    const value = thinking.value;
    return typeof value === 'string'
      ? { textChars: value.length, fixedTokens: 0 }
      : { textChars: value.reduce((sum, chunk) => sum + chunk.length, 0), fixedTokens: 0 };
  }

  if (isPromptTsxPart(part)) {
    try {
      return {
        textChars: JSON.stringify((part as { value?: unknown }).value).length,
        fixedTokens: 0,
      };
    } catch {
      return { textChars: 0, fixedTokens: 0 };
    }
  }

  if (part && typeof part === 'object') {
    try {
      return { textChars: JSON.stringify(part).length, fixedTokens: 0 };
    } catch {
      return { textChars: 0, fixedTokens: 0 };
    }
  }

  return { textChars: 0, fixedTokens: 0 };
}

/** True for the proposed `LanguageModelThinkingPart` when it exists at runtime. */
function isLanguageModelThinkingPart(part: unknown): boolean {
  const ctor = (vscode as unknown as { LanguageModelThinkingPart?: new () => object })
    .LanguageModelThinkingPart;
  return typeof ctor === 'function' && part instanceof ctor;
}

/** True for `LanguageModelPromptTsxPart` (duck-typed; proposed API). */
function isPromptTsxPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }
  const ctor = (part as { constructor?: { name?: string } }).constructor;
  return ctor?.name === 'LanguageModelPromptTsxPart';
}

/**
 * Estimate tokens for a string or a full chat message.
 *
 * Messages sum every content part: text, tool calls, tool results (recursively),
 * data parts, thinking, and prompt-tsx. A message never reports zero tokens.
 */
export function estimateTokenCount(
  text: string | vscode.LanguageModelChatMessage,
  charsPerToken: number
): number {
  if (typeof text === 'string') {
    if (!text) {
      return 0;
    }
    return Math.max(1, Math.ceil(text.length / charsPerToken));
  }

  if (!text?.content || !Array.isArray(text.content)) {
    return 1;
  }

  let totalChars = 0;
  let fixedTokens = 0;
  for (const part of text.content) {
    const estimate = estimatePart(part);
    totalChars += estimate.textChars;
    fixedTokens += estimate.fixedTokens;
  }

  const textTokens = totalChars > 0 ? Math.ceil(totalChars / charsPerToken) : 0;
  return Math.max(1, textTokens + fixedTokens);
}

/**
 * Estimate tokens from a character count.
 *
 * Separate from `estimateTokenCount` because that one measures a string's
 * length; passing a number through it would measure the digits of the number
 * instead of the amount of text.
 */
export function estimateTokensFromChars(charCount: number, charsPerToken: number): number {
  if (charCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(charCount / charsPerToken));
}

/**
 * Update the adaptive chars-per-token ratio using exponential moving average.
 * newRatio = oldRatio * 0.7 + observedRatio * 0.3
 */
export function updateCharsPerToken(
  totalRequestChars: number,
  promptTokens: number,
  currentCharsPerToken: number
): number {
  if (totalRequestChars > 0 && promptTokens > 0) {
    const observedRatio = totalRequestChars / promptTokens;
    return currentCharsPerToken * 0.7 + observedRatio * 0.3;
  }
  return currentCharsPerToken;
}
