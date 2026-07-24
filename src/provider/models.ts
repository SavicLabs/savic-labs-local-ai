/**
 * Model auto-discovery and Copilot Chat model picker metadata.
 *
 * Queries the llama.cpp router's /v1/models endpoint to discover available
 * models, their capabilities, and context sizes. No hardcoded model lists.
 */
import * as vscode from 'vscode';
import { SavicLabsClient } from '../client/core';
import { THINKING_SPEC_TYPES, isThinkingModelId, DEFAULT_MAX_OUTPUT_TOKENS } from '../consts';
import { logger } from '../logger';
import { t } from '../i18n';

/** Raw model entry from /v1/models response. */
interface DiscoveredModelEntry {
  id: string;
  aliases?: string[];
  status?: {
    value: string;
    args: string[];
    failed?: boolean;
    exit_code?: number;
  };
  meta?: {
    n_ctx?: number;
    n_params?: number;
    size?: number;
    ftype?: string;
  };
  architecture?: {
    input_modalities?: string[];
  };
}

/** Parsed model information for internal use. */
export interface DiscoveredModel {
  id: string;
  displayName: string;
  detail: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  hasThinking: boolean;
  hasVision: boolean;
  isLoaded: boolean;
  isFailed: boolean;
  specType: string;
  quantType: string;
}

/** /v1/models API response shape. */
interface ModelsResponse {
  data?: DiscoveredModelEntry[];
}

/**
 * Fetch available models from the API endpoint.
 */
export async function fetchModels(
  client: SavicLabsClient,
  token?: vscode.CancellationToken
): Promise<DiscoveredModel[]> {
  const url = `${client.baseUrl}/models`;

  const controller = new AbortController();
  const cancelListener = token?.onCancellationRequested(() => controller.abort());

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const raw: ModelsResponse = await response.json();

    if (!raw.data || !Array.isArray(raw.data)) {
      logger.warn('Unexpected /v1/models response format', raw);
      return [];
    }

    return raw.data
      .filter((m) => m.id && m.id !== 'default')
      .map((m) => parseModelEntry(m));
  } finally {
    cancelListener?.dispose();
  }
}

/**
 * Parse a single model entry from the API.
 */
function parseModelEntry(entry: DiscoveredModelEntry): DiscoveredModel {
  const id = entry.id;
  const displayAlias = entry.aliases?.[0];

  // Parse context size from args or meta
  let ctxSize = 32768;
  if (entry.meta?.n_ctx) {
    ctxSize = entry.meta.n_ctx;
  } else if (entry.status?.args) {
    const ctxIdx = entry.status.args.indexOf('--ctx-size');
    if (ctxIdx >= 0 && ctxIdx + 1 < entry.status.args.length) {
      const parsed = parseInt(entry.status.args[ctxIdx + 1], 10);
      if (!isNaN(parsed)) {
        ctxSize = parsed;
      }
    }
  }

  // Detect spec-type for thinking capability
  let specType = 'none';
  if (entry.status?.args) {
    const stIdx = entry.status.args.indexOf('--spec-type');
    if (stIdx >= 0 && stIdx + 1 < entry.status.args.length) {
      specType = entry.status.args[stIdx + 1];
    }
  }

  // Detect thinking capability
  const hasThinking =
    THINKING_SPEC_TYPES.has(specType) || isThinkingModelId(id);

  // Detect vision capability
  const modalities = entry.architecture?.input_modalities ?? [];
  const hasVision = modalities.includes('image');

  // Status
  const isLoaded = entry.status?.value === 'loaded';
  const isFailed = entry.status?.failed === true || entry.status?.value === 'failed';

  // Quant type
  const quantType = entry.meta?.ftype ?? guessQuantFromId(id);

  // Display name
  let displayName: string;
  if (displayAlias) {
    displayName = displayAlias;
  } else {
    displayName = cleanModelId(id);
  }

  // Detail line
  const parts: string[] = [];
  parts.push(`${quantType}`);
  parts.push(`${ctxSize >= 1024 ? Math.round(ctxSize / 1024) + 'K' : ctxSize} ctx`);
  if (hasThinking) {
    parts.push('thinking');
  }
  if (hasVision) {
    parts.push('vision');
  }
  if (!isLoaded) {
    parts.push('unloaded');
  }
  if (isFailed) {
    parts.push('CRASHED');
  }
  const detail = parts.join(' · ');

  return {
    id,
    displayName,
    detail,
    maxInputTokens: ctxSize,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    hasThinking,
    hasVision,
    isLoaded,
    isFailed,
    specType,
    quantType,
  };
}

/**
 * Convert a discovered model to VS Code LanguageModelChatInformation.
 */
export function toChatInfo(model: DiscoveredModel): vscode.LanguageModelChatInformation {
  return {
    id: model.id,
    name: model.displayName,
    family: 'SavicLabs',
    version: '1',
    detail: model.detail,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: {
      toolCalling: 128,
      imageInput: model.hasVision,
      ...(model.hasThinking && !model.isFailed ? { thinking: true } : {}),
    },
    ...(model.hasThinking && !model.isFailed
      ? { configurationSchema: buildThinkingEffortSchema() }
      : {}),
    ...(model.isFailed
      ? { statusIcon: new vscode.ThemeIcon('warning'), tooltip: 'This model failed to load on the server. Restart your llama.cpp router to retry.' }
      : {}),
  };
}

/**
 * Build the thinking/reasoning effort configuration schema for the model picker.
 */
function buildThinkingEffortSchema(): vscode.LanguageModelChatConfigurationSchema {
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: t('status.thinking'),
        enum: ['none', 'high', 'max'],
        enumItemLabels: [
          t('thinking.none'),
          t('thinking.high'),
          t('thinking.max'),
        ],
        enumDescriptions: [
          t('thinking.none.desc'),
          t('thinking.high.desc'),
          t('thinking.max.desc'),
        ],
        default: 'high',
        group: 'navigation',
      },
    },
  };
}

/**
 * Get the configured thinking effort from model options.
 */
export function getConfiguredThinkingEffort(options: vscode.LanguageModelChatRequestOptions): 'none' | 'high' | 'max' {
  const configuredEffort =
    (options as Record<string, unknown>).modelConfiguration as { reasoningEffort?: string } | undefined;

  if (typeof configuredEffort === 'string') {
    if (configuredEffort === 'none') return 'none';
    if (configuredEffort === 'max') return 'max';
    if (configuredEffort === 'high') return 'high';
  }
  return 'high';
}

// ---- Helpers ----

/** Clean up a HuggingFace-style model ID for display. */
function cleanModelId(id: string): string {
  // Remove hf-repo prefix
  let name = id.replace(/^.+\/([^/]+)$/, '$1');

  // Split by colon and take last meaningful part
  const colonParts = name.split(':');
  if (colonParts.length > 1) {
    // If it's a quant tag, keep both parts
    const last = colonParts[colonParts.length - 1];
    if (/^[QI][0-9]/.test(last) || /^F[0-9]/.test(last)) {
      return colonParts.slice(-2).join(' ');
    }
    name = last;
  }

  return name;
}

/** Guess quantization type from model ID. */
function guessQuantFromId(id: string): string {
  const match = id.match(/[QI]\d[_-]?[KMSXL_]+/i);
  return match ? match[0].toUpperCase() : 'unknown';
}
