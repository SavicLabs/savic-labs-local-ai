/**
 * Model auto-discovery and Copilot Chat model picker metadata.
 *
 * Queries the llama.cpp router's /v1/models endpoint to discover available
 * models, their capabilities, and context sizes. No hardcoded model lists.
 */
import * as vscode from 'vscode';
import { THINKING_SPEC_TYPES, isThinkingModelId, DEFAULT_MAX_OUTPUT_TOKENS, ZAI_MODELS, isZaiCodingPlan } from '../consts';
import { getApiKeyForEndpoint } from '../secrets';
import { logger } from '../logger';
import { t } from '../i18n';

/** Raw model entry from /v1/models response. */
interface DiscoveredModelEntry {
  id: string;
  aliases?: string[];
  display_name?: string;
  context_window?: number;
  owned_by?: string;
  status?: {
    value: string;
    args: string[];
    failed?: boolean;
    exit_code?: number;
  };
  meta?: {
    n_ctx?: number;
    n_ctx_train?: number;
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
  /** Whether the model is served by a cloud provider (expanded limits). */
  isCloud: boolean;
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

  return allModels;
}

/**
 * Fetch models from a single endpoint.
 * For z.ai endpoints, falls back to a hardcoded GLM model catalog if /models fails.
 */
async function fetchModelsFromEndpoint(
  endpoint: string,
  token?: vscode.CancellationToken
): Promise<DiscoveredModel[]> {
  const url = `${endpoint.replace(/\/+$/, '')}/models`;
  const apiKey = getApiKeyForEndpoint(endpoint);

  const controller = new AbortController();
  const cancelListener = token?.onCancellationRequested(() => controller.abort());

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    });

    if (!response.ok) {
      // For z.ai endpoints, fall back to hardcoded model catalog
      if (isZaiEndpoint(endpoint)) {
        logger.info(`z.ai /models returned ${response.status}, using hardcoded GLM catalog`);
        return getZaiModels(endpoint);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const raw: ModelsResponse = await response.json();

    if (!raw.data || !Array.isArray(raw.data) || raw.data.length === 0) {
      // Empty response — fall back for z.ai
      if (isZaiEndpoint(endpoint)) {
        logger.info('z.ai /models returned empty, using hardcoded GLM catalog');
        return getZaiModels(endpoint);
      }
      logger.warn('Unexpected /v1/models response format', raw);
      return [];
    }

    return raw.data
      .filter((m) => m.id && m.id !== 'default')
      .map((m) => parseModelEntry(m, endpoint));
  } catch (error) {
    // Network errors — fall back for z.ai
    if (isZaiEndpoint(endpoint)) {
      logger.info(`z.ai /models failed (${error instanceof Error ? error.message : String(error)}), using hardcoded GLM catalog`);
      return getZaiModels(endpoint);
    }
    throw error;
  } finally {
    cancelListener?.dispose();
  }
}

/** Check if an endpoint URL points to z.ai. */
function isZaiEndpoint(endpoint: string): boolean {
  const normalized = endpoint.toLowerCase().replace(/\/+$/, '');
  return normalized.includes('z.ai') || normalized.includes('bigmodel.cn');
}

/**
 * Build the hardcoded z.ai GLM model catalog.
 * Used as fallback when the /models endpoint is unavailable.
 * Filters models by endpoint type: coding plan only supports 3 models.
 */
function getZaiModels(endpoint: string): DiscoveredModel[] {
  const sourceLabel = 'z.ai';
  const isCodingPlan = isZaiCodingPlan(endpoint);
  const models = isCodingPlan
    ? ZAI_MODELS.filter((m) => m.codingPlan)
    : ZAI_MODELS;

  return models.map((m) => {
    const ctxSize = m.contextLength;
    const parts: string[] = [];
    parts.push(m.isFree ? 'free' : 'cloud');
    parts.push(`${ctxSize >= 1024 ? Math.round(ctxSize / 1024) + 'K' : ctxSize} ctx`);
    if (m.hasThinking) parts.push('thinking');
    // Show quota cost for coding plan models
    if (isCodingPlan && m.quotaMultiplier !== '1× standard') {
      parts.push(m.quotaMultiplier);
    }
    const detail = parts.join(' · ');

    return {
      id: m.id,
      displayName: `${m.displayName}  ·  ${sourceLabel}`,
      detail,
      maxInputTokens: ctxSize,
      maxOutputTokens: m.maxOutput,
      hasThinking: m.hasThinking,
      hasVision: false,
      isLoaded: true, // Cloud models are always "loaded"
      isFailed: false,
      specType: 'none',
      quantType: m.isFree ? 'free' : 'cloud',
      isCloud: true,
      sourceUrl: endpoint,
      sourceLabel,
    } satisfies DiscoveredModel;
  });
}

/**
 * Detect if a model is a cloud-hosted model (not a local GGUF).
 * Cloud models typically have a ":cloud" suffix in their ID (Ollama convention)
 * or are served by a remote provider rather than a local llama.cpp/Ollama instance.
 */
function isCloudModel(id: string, sourceLabel: string): boolean {
  const lowerId = id.toLowerCase();
  // Ollama cloud models use :cloud suffix (e.g., qwen3-coder-next:cloud)
  if (lowerId.includes(':cloud') || lowerId.endsWith('-cloud')) {
    return true;
  }
  // Models from cloud providers (non-local source labels)
  // Note: z.ai API returns owned_by as "z-ai" (hyphen), not "z.ai" (dot)
  const cloudSources = ['openai', 'anthropic', 'groq', 'together', 'fireworks', 'openrouter', 'mistral', 'z.ai', 'z-ai', 'bigmodel', 'verboo'];
  const lowerSource = sourceLabel.toLowerCase();
  if (cloudSources.some(s => lowerSource.includes(s))) {
    return true;
  }
  return false;
}

/** Context size used for cloud models (effectively unlimited). */
const CLOUD_MODEL_MAX_CONTEXT = 1_000_000;
/** Max output tokens for cloud models (generous default — 128K for GLM-5.2). */
const CLOUD_MODEL_MAX_OUTPUT = 131_072;
/**
 * Last-resort context size for a local model when the server reports neither
 * spawn args nor GGUF metadata. Only used as a fallback — never as a cap.
 */
const LOCAL_MODEL_FALLBACK_CONTEXT = 65_536;

/**
 * Parse a single model entry from the API.
 */
function parseModelEntry(entry: DiscoveredModelEntry, endpoint: string): DiscoveredModel {
  const id = entry.id;
  const displayAlias = entry.aliases?.[0] || entry.display_name;

  // Build source label first — needed for cloud model detection
  const ownedBy = entry.owned_by;
  let sourceLabel: string;
  if (ownedBy === 'llamacpp') {
    sourceLabel = 'llama.cpp';
  } else if (ownedBy && ownedBy !== 'library') {
    sourceLabel = ownedBy;
  } else {
    try {
      const u = new URL(endpoint);
      const port = u.port;
      if (port === '11434' || u.hostname.includes('ollama')) {
        sourceLabel = 'Ollama';
      } else if (port === '8000' || u.hostname.includes('vllm')) {
        sourceLabel = 'vLLM';
      } else if (port === '5000' || u.hostname.includes('oobabooga') || u.hostname.includes('text-generation')) {
        sourceLabel = 'TGWUI';
      } else if (port === '1234' || u.hostname.includes('lmstudio')) {
        sourceLabel = 'LM Studio';
      } else if (u.hostname.includes('z.ai') || u.hostname.includes('bigmodel.cn')) {
        sourceLabel = 'z-ai';
      } else {
        sourceLabel = `:${port || '80'}`;
      }
    } catch {
      sourceLabel = endpoint.replace(/https?:\/\//, '').split('/')[0];
    }
  }

  // Cloud models get unlimited context — they're not constrained by local VRAM
  const cloud = isCloudModel(id, sourceLabel);

  // Parse context size.
  //
  // Local models: prefer the actual runtime context the server was spawned with
  // (`--ctx-size` in `status.args`). Cap it by the model's training limit only
  // when that limit is *known*.
  //
  // IMPORTANT: the llama.cpp router only populates `meta` (n_ctx / n_ctx_train)
  // for models that are currently LOADED — an unloaded model has no `meta` at
  // all. Defaulting the training limit to a small constant therefore clamped
  // every unloaded model down to that constant (a 256K preset showed as 64K
  // until it happened to be loaded). Unknown training limit ⇒ don't cap.
  let ctxSize = LOCAL_MODEL_FALLBACK_CONTEXT;

  if (cloud) {
    // Cloud models — prefer the server-reported context window when present
    // (e.g. Verboo returns context_window per model: 1M for most, 256K for qwen3.6-27b)
    const serverCtx = entry.context_window;
    ctxSize = serverCtx && serverCtx > 0 ? serverCtx : CLOUD_MODEL_MAX_CONTEXT;
  } else {
    // Absolute training limit from GGUF metadata — only present when loaded.
    const ctxTrain =
      entry.meta?.n_ctx_train && entry.meta.n_ctx_train > 0
        ? entry.meta.n_ctx_train
        : undefined;

    // Actual runtime context the server spawned this preset with (most accurate).
    let ctxFromArgs: number | undefined;
    if (entry.status?.args) {
      const ctxIdx = entry.status.args.indexOf('--ctx-size');
      if (ctxIdx >= 0 && ctxIdx + 1 < entry.status.args.length) {
        const parsed = parseInt(entry.status.args[ctxIdx + 1], 10);
        if (!isNaN(parsed) && parsed > 0) {
          ctxFromArgs = parsed;
        }
      }
    }

    if (ctxFromArgs !== undefined) {
      // Effective context = min(requested, training limit), but only clamp when
      // the training limit is known — otherwise keep the requested size.
      ctxSize = ctxTrain ? Math.min(ctxFromArgs, ctxTrain) : ctxFromArgs;
    } else if (entry.meta?.n_ctx) {
      // No spawn args — fall back to GGUF metadata (clamped by training limit if known)
      ctxSize = ctxTrain ? Math.min(entry.meta.n_ctx, ctxTrain) : entry.meta.n_ctx;
    }
    // Otherwise keep LOCAL_MODEL_FALLBACK_CONTEXT.
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

  // Display name — source label baked in so users can always distinguish
  let displayName: string;
  if (displayAlias) {
    displayName = displayAlias;
  } else {
    displayName = cleanModelId(id);
  }
  displayName = `${displayName}  ·  ${sourceLabel}`;

  // Remove deduplication — source is now always in the name
  // Detail line — technical specs only
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
    maxOutputTokens: cloud ? CLOUD_MODEL_MAX_OUTPUT : DEFAULT_MAX_OUTPUT_TOKENS,
    hasThinking,
    hasVision,
    isLoaded,
    isFailed,
    specType,
    quantType,
    isCloud: cloud,
    sourceUrl: endpoint,
    sourceLabel,
  };
}

/**
 * Build the source-unique picker ID for a discovered model.
 *
 * `<modelId>@<sourceLabel>` (e.g. `glm-5.2@z-ai`) so identical model IDs from
 * different endpoints (Verboo's `glm-5.2` vs z.ai's `glm-5.2`) don't collide
 * in VS Code's model picker. The `@source` suffix is stripped back to the real
 * API model ID at request time in `getApiModelId`.
 */
export function toModelPickerId(model: Pick<DiscoveredModel, 'id' | 'sourceLabel'>): string {
  return `${model.id}@${model.sourceLabel}`;
}

/**
 * Convert a discovered model to VS Code LanguageModelChatInformation.
 */
export function toChatInfo(model: DiscoveredModel): vscode.LanguageModelChatInformation {
  const uniqueId = toModelPickerId(model);
  return {
    id: uniqueId,
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
    configurationSchema: buildConfigurationSchema(model),
    ...(model.isFailed
      ? { statusIcon: new vscode.ThemeIcon('warning'), tooltip: 'This model failed to load on the server. Restart your llama.cpp router to retry.' }
      : {}),
  };
}

/**
 * Build the model configuration schema for the picker sidebar.
 * Includes max output tokens for all models, reasoning effort for thinking models.
 */
function buildConfigurationSchema(model: DiscoveredModel): vscode.LanguageModelChatConfigurationSchema {
  // Build context size options — always include 0 (server default) + common sizes
  const serverCtx = model.maxInputTokens;
  const isCloud = model.isCloud ?? (serverCtx >= 1_000_000); // cloud models use CLOUD_MODEL_MAX_CONTEXT
  const serverCtxK = serverCtx >= 1024 ? Math.round(serverCtx / 1024) : serverCtx;
  const ctxOptions = ['0']; // 0 = use full server context
  if (isCloud) {
    // Cloud models — show unlimited + large standard options
    for (const k of [32, 64, 128, 256, 512, 1024]) {
      ctxOptions.push(String(k * 1024));
    }
    ctxOptions.push('0-unlimited'); // explicit unlimited marker
  } else {
    for (const k of [4, 8, 16, 32, 64, 128]) {
      if (k * 1024 < serverCtx) ctxOptions.push(String(k * 1024));
    }
    ctxOptions.push(String(serverCtx)); // full server context as explicit option
  }

  const ctxLabels = ctxOptions.map(v => {
    if (v === '0-unlimited') return 'Unlimited';
    const n = parseInt(v, 10);
    if (n === 0) return isCloud ? 'Unlimited (cloud)' : `Server default (${serverCtxK}K)`;
    if (n >= 1024) return `${Math.round(n / 1024)}K`;
    return String(n);
  });

  const properties: Record<string, unknown> = {
    maxContextTokens: {
      type: 'string',
      title: 'Max Context',
      description: `Limits input tokens sent to the model. Lower = faster prompt processing. Server context: ${serverCtxK}K.`,
      enum: ctxOptions,
      enumItemLabels: ctxLabels,
      default: '0',
      group: 'navigation',
    },
    maxTokens: {
      type: 'string',
      title: 'Max Output Tokens',
      description: 'Maximum tokens in the response. Unlimited = omit the limit, letting the API use its own default.',
      enum: isCloud
        ? ['0', '4096', '8192', '16384', '32768', '65536', '131072']
        : ['0', '512', '1024', '2048', '4096', '8192', '16384', '32768', '65536'],
      enumItemLabels: isCloud
        ? ['Unlimited', '4K', '8K', '16K', '32K', '64K', '128K']
        : ['Unlimited', '512', '1K', '2K', '4K', '8K', '16K', '32K', '64K'],
      default: '0',
      group: 'navigation',
    },
  };

  if (model.hasThinking && !model.isFailed) {
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
  // VS Code passes config through modelOptions at runtime, modelConfiguration is our augmentation
  const modelConfig = (options as Record<string, unknown>).modelOptions || (options as Record<string, unknown>).modelConfiguration;
  const configuredEffort = (modelConfig as { reasoningEffort?: string } | undefined)?.reasoningEffort;

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
