/**
 * Compile-time constants for the SavicLabs extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For runtime settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'savicLabs';

/** External URLs. */
export const EXTERNAL_URLS = {
  llamaCpp: {
    github: 'https://github.com/ggml-org/llama.cpp',
    docs: 'https://github.com/ggml-org/llama.cpp/blob/master/examples/server/README.md',
  },
} as const;

/** Maximum number of tool functions per request. */
export const TOOLS_LIMIT = 128;

/** Default endpoint for llama.cpp router. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:18080/v1';

/** Default max output tokens (0 = unlimited/API default). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Z.ai API endpoints (OpenAI-compatible). */
export const ZAI_ENDPOINTS = {
  /** Pay-as-you-go API. */
  paas: 'https://api.z.ai/api/paas/v4',
  /** GLM Coding Plan subscription API. */
  coding: 'https://api.z.ai/api/coding/paas/v4',
} as const;

/** Z.ai GLM model catalog — used as fallback when /models endpoint doesn't work.
 * Coding Plan only supports: glm-5.2, glm-5-turbo, glm-4.7.
 * PaaS supports all models. Quota cost multiplier for Coding Plan:
 *   GLM-5.2 / GLM-5-Turbo: 3× peak hours, 2× off-peak
 *   GLM-4.7: 1× always (standard rate)
 */
export interface ZaiModelInfo {
  id: string;
  displayName: string;
  contextLength: number;
  maxOutput: number;
  isFree: boolean;
  hasThinking: boolean;
  /** Available on the Coding Plan endpoint. */
  codingPlan: boolean;
  /** Quota cost multiplier on coding plan: '3x' for peak, '1x' for standard. */
  quotaMultiplier: string;
}

export const ZAI_MODELS: readonly ZaiModelInfo[] = [
  { id: 'glm-5.2',       displayName: 'GLM-5.2',      contextLength: 1_000_000, maxOutput: 131_072, isFree: false, hasThinking: true, codingPlan: true,  quotaMultiplier: '3× peak' },
  { id: 'glm-5-turbo',   displayName: 'GLM-5-Turbo', contextLength: 1_000_000, maxOutput: 131_072, isFree: false, hasThinking: true, codingPlan: true,  quotaMultiplier: '3× peak' },
  { id: 'glm-4.7',       displayName: 'GLM-4.7',     contextLength: 200_000,   maxOutput: 131_072, isFree: false, hasThinking: true, codingPlan: true,  quotaMultiplier: '1× standard' },
  { id: 'glm-5.1',       displayName: 'GLM-5.1',     contextLength: 1_000_000, maxOutput: 131_072, isFree: false, hasThinking: true, codingPlan: false, quotaMultiplier: 'PaaS only' },
  { id: 'glm-4.7-flash', displayName: 'GLM-4.7-Flash', contextLength: 200_000, maxOutput: 131_072, isFree: true,  hasThinking: true, codingPlan: false, quotaMultiplier: 'free' },
  { id: 'glm-4.6',       displayName: 'GLM-4.6',     contextLength: 200_000,   maxOutput: 131_072, isFree: false, hasThinking: true, codingPlan: false, quotaMultiplier: 'PaaS only' },
  { id: 'glm-4.5',       displayName: 'GLM-4.5',     contextLength: 128_000,   maxOutput: 98_304,  isFree: false, hasThinking: true, codingPlan: false, quotaMultiplier: 'PaaS only' },
  { id: 'glm-4.5-air',   displayName: 'GLM-4.5-Air', contextLength: 128_000,   maxOutput: 98_304,  isFree: false, hasThinking: true, codingPlan: false, quotaMultiplier: 'PaaS only' },
  { id: 'glm-4.5-flash', displayName: 'GLM-4.5-Flash', contextLength: 128_000, maxOutput: 98_304,  isFree: true,  hasThinking: true, codingPlan: false, quotaMultiplier: 'free' },
] as const;

/** Check if a z.ai endpoint is the Coding Plan endpoint. */
export function isZaiCodingPlan(endpoint: string): boolean {
  return endpoint.toLowerCase().includes('/coding/paas/v4');
}

/** Speculative decoding types that indicate thinking/reasoning support. */
export const THINKING_SPEC_TYPES = new Set(['draft-mtp']);

/** Model families that are likely Qwen-based (support thinking). */
const QWEN_PATTERNS = [/qwen/i, /qwq/i, /cqr/i];

/** Detect if a model ID likely supports thinking based on naming patterns. */
export function isThinkingModelId(modelId: string): boolean {
  return QWEN_PATTERNS.some((pattern) => pattern.test(modelId));
}
