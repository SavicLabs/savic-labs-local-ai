/**
 * Replay marker encode/decode for context caching.
 *
 * Replay markers are binary LanguageModelDataParts embedded in assistant
 * messages. They carry cached image descriptions and reasoning content
 * so subsequent turns can replay them without re-processing.
 */
import * as vscode from 'vscode';
import { REPLAY_MARKER_MIME, REPLAY_MARKER_WRITER_ID, REPLAY_MARKER_PREFIXES } from './consts';

/** Parsed replay marker metadata. */
export interface ReplayMarkerParsed {
  valid: boolean;
  error?: string;
  segmentId?: string;
  visionText?: string;
  reasoningText?: string;
  legacySegmentOnly?: boolean;
  payloadFormat?: string;
}

/** Metadata to encode into a replay marker. */
export interface ReplayMarkerMetadata {
  visionText?: string;
  reasoningText?: string;
  segmentId?: string;
}

/** Result of finding a replay marker in a message. */
export interface ReplayMarkerLocation {
  partIndex: number;
  marker: ReplayMarkerParsed;
}

/**
 * Find the first replay marker in a VS Code message.
 */
export function findFirstReplayMarker(
  message: vscode.LanguageModelChatMessage
): ReplayMarkerLocation | undefined {
  for (const [partIndex, part] of message.content.entries()) {
    const marker = parseReplayMarkerPart(part);
    if (marker) {
      return { partIndex, marker };
    }
  }
  return undefined;
}

/**
 * Parse the first replay marker from a message (convenience).
 */
export function parseFirstReplayMarker(
  message: vscode.LanguageModelChatMessage
): ReplayMarkerParsed | undefined {
  return findFirstReplayMarker(message)?.marker;
}

/**
 * Check if a data part is a replay marker.
 */
function parseReplayMarkerPart(part: unknown): ReplayMarkerParsed | undefined {
  if (!(part instanceof vscode.LanguageModelDataPart)) {
    return undefined;
  }
  if (part.mimeType !== REPLAY_MARKER_MIME) {
    return undefined;
  }
  return parseReplayMarkerData(part.data);
}

/**
 * Check if marker metadata has any content worth caching.
 */
export function hasReplayMarkerMetadata(metadata: ReplayMarkerMetadata): boolean {
  return Boolean(metadata.visionText || metadata.reasoningText);
}

/**
 * Create a replay marker LanguageModelDataPart.
 */
export function createReplayMarkerPart(
  metadata: ReplayMarkerMetadata
): vscode.LanguageModelDataPart {
  const payload: Record<string, string> = {};

  if (metadata.visionText) {
    payload.v = metadata.visionText;
  }
  if (metadata.reasoningText) {
    payload.r = metadata.reasoningText;
  }
  if (metadata.segmentId) {
    payload.s = metadata.segmentId;
  }

  const encoded = new TextEncoder().encode(
    `${REPLAY_MARKER_WRITER_ID}\\${JSON.stringify(payload)}`
  );
  return new vscode.LanguageModelDataPart(encoded, REPLAY_MARKER_MIME);
}

/**
 * Parse replay marker binary data.
 */
export function parseReplayMarkerData(data: Uint8Array): ReplayMarkerParsed {
  const decoded = new TextDecoder().decode(data);
  const separatorIndex = decoded.indexOf('\\');

  if (separatorIndex < 0) {
    return { valid: false, error: 'marker-prefix-missing' };
  }

  const markerPrefix = decoded.slice(0, separatorIndex);
  if (!REPLAY_MARKER_PREFIXES.has(markerPrefix)) {
    return { valid: false, error: 'marker-prefix-mismatch' };
  }

  const markerPayload = decoded.slice(separatorIndex + 1);

  try {
    const value = JSON.parse(markerPayload);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { valid: false, error: 'marker-payload-not-object' };
    }

    return {
      valid: true,
      segmentId: typeof value.s === 'string' ? value.s : undefined,
      visionText: typeof value.v === 'string' ? value.v : undefined,
      reasoningText: typeof value.r === 'string' ? value.r : undefined,
      payloadFormat: 'json',
    };
  } catch {
    return { valid: false, error: 'marker-json-invalid' };
  }
}
