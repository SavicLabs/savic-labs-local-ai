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
  owned_by?: string;
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
  /** Source endpoint URL for routing requests. */
  sourceUrl: string;
  /** Human-readable source label (e.g., "llama.cpp", "Ollama"). */
  sourceLabel: string;
}

/** /v1/models API response shape. */
interface ModelsResponse {
  data?: DiscoveredModelEntry[];
}

/**
 * Fetch available models from ALL configured endpoints.
 * Aggregates results and labels each model with its source.
 */
export async function fetchAllModels(
  endpoints: string[],
  token?: vscode.CancellationToken
): Promise<DiscoveredModel[]> {
  const allModels: DiscoveredModel[] = [];

  for (const endpoint of endpoints) {
    if (token?.isCancellationRequested) break;

    try {
      const models = await fetchModelsFromEndpoint(endpoint, token);
      allModels.push(...models);
    } catch (error) {
      logger.warn(`Failed to fetch models from ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
      // Continue with other endpoints
    }
  }

  return deduplicateModels(allModels);
}

/** Deduplicate models across endpoints. If same name appears twice, tag with source. */
function deduplicateModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const nameCounts = new Map<string, number>();
  for (const m of models) {
    nameCounts.set(m.displayName, (nameCounts.get(m.displayName) || 0) + 1);
  }

  return models.map((m) => {
    if ((nameCounts.get(m.displayName) || 0) > 1) {
      // Append source to disambiguate
      return { ...m, displayName: `${m.displayName} (${m.sourceLabel})` };
    }
    return m;
  });
}

/**
 * Fetch models from a single endpoint.
 */
async function fetchModelsFromEndpoint(
  endpoint: string,
  token?: vscode.CancellationToken
): Promise<DiscoveredModel[]> {
  const url = `${endpoint.replace(/\/+$/, '')}/models`;

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
      .map((m) => parseModelEntry(m, endpoint));
  } finally {
    cancelListener?.dispose();
  }
}

/**
 * Parse a single model entry from the API.
 */
function parseModelEntry(entry: DiscoveredModelEntry, endpoint: string): DiscoveredModel {
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

  // Build source label
  const ownedBy = entry.owned_by;
  let sourceLabel: string;
  if (ownedBy && ownedBy !== 'llamacpp') {
    sourceLabel = ownedBy;
  } else {
    try {
      const hostname = new URL(endpoint).hostname;
      sourceLabel = hostname === '127.0.0.1' || hostname === 'localhost'
        ? `port ${new URL(endpoint).port || '80'}`
        : hostname;
    } catch {
      sourceLabel = endpoint.replace(/https?:\/\//, '').split('/')[0];
    }
  }

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

  // Detail line — source label FIRST so it's always visible
  const parts: string[] = [];
  parts.push(`[${sourceLabel}]`);
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
    sourceUrl: endpoint,
    sourceLabel,
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
    configurationSchema: buildConfigurationSchema(model.hasThinking && !model.isFailed),
    ...(model.isFailed
      ? { statusIcon: new vscode.ThemeIcon('warning'), tooltip: 'This model failed to load on the server. Restart your llama.cpp router to retry.' }
      : {}),
  };
}

/**
 * Build the model configuration schema for the picker sidebar.
 * Includes max output tokens for all models, reasoning effort for thinking models.
 */
function buildConfigurationSchema(hasThinking: boolean): vscode.LanguageModelChatConfigurationSchema {
  const properties: Record<string, unknown> = {
    maxTokens: {
      type: 'number',
      title: 'Max Output Tokens',
      description: 'Maximum tokens in the response. 0 = unlimited (server default).',
      default: 0,
      minimum: 0,
      maximum: 100000,
      group: 'navigation',
    },
  };

  if (hasThinking) {
    properties.reasoningEffort = {
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
    };
  }

  return { properties } as vscode.LanguageModelChatConfigurationSchema;
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

/** Clean up a model ID for display. */
function cleanModelId(id: string): string {
  // HF repo style: "org/ModelName-GGUF:quant" → "ModelName quant"
  const hfMatch = id.match(/^.+\/([^/]+)$/);
  if (hfMatch) {
    const stripped = hfMatch[1]; // e.g., "Qwen3.6-27B-GGUF:Q4_K_M"
    return stripped
      .replace(/-GGUF$/i, '')
      .replace(/:/g, ' ')
      .replace(/-/g, ' ');
  }

  // Ollama style: "qwen3.5:14b", "codellama:13b-instruct" → replace : with space
  if (id.includes(':')) {
    return id.replace(/:/g, ' ');
  }

  return id;
}

/** Guess quantization type from model ID. */
function guessQuantFromId(id: string): string {
  const match = id.match(/[QI]\d[_-]?[KMSXL_]+/i);
  return match ? match[0].toUpperCase() : 'unknown';
}
