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

/** URI path to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path to open endpoint configuration. */
export const CONFIGURE_ENDPOINT_URI_PATH = '/setEndpoint';

/** URI path to open vision model configuration. */
export const SET_VISION_MODEL_URI_PATH = '/setVisionModel';

/** VS Code's internal LanguageModelChatMessageRole.System (not exposed in @types/vscode). */
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'SavicLabs.savic-labs-local-ai#savicLabsGettingStarted';

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'savicLabs.welcomeShown';

/** Maximum number of tool functions per request. */
export const TOOLS_LIMIT = 128;

/** Default endpoint for llama.cpp router. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:18080/v1';

/** Default max output tokens (0 = unlimited/API default). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Speculative decoding types that indicate thinking/reasoning support. */
export const THINKING_SPEC_TYPES = new Set(['draft-mtp']);

/** Model families known to support thinking/reasoning. */
export const THINKING_FAMILIES = ['qwen', 'qwq', 'deepseek-r1', 'deepseek-v3'];

/** Model families that are likely Qwen-based (support thinking). */
const QWEN_PATTERNS = [/qwen/i, /qwq/i, /cqr/i];

/** Detect if a model ID likely supports thinking based on naming patterns. */
export function isThinkingModelId(modelId: string): boolean {
  return QWEN_PATTERNS.some((pattern) => pattern.test(modelId));
}
