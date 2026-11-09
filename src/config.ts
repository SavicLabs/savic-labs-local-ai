/**
 * Runtime configuration reader.
 *
 * Reads extension settings from VS Code's workspace configuration.
 * All functions read live settings — no caching here (use caller-side caching if needed).
 */
import * as vscode from 'vscode';
import { CONFIG_SECTION, DEFAULT_BASE_URL } from './consts';

/** Get the primary API base URL from settings. */
export function getBaseUrl(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string>('baseUrl') || DEFAULT_BASE_URL;
}

/**
 * Get all configured endpoint URLs.
 * Falls back to the single baseUrl if endpoints array is empty.
 */
export function getEndpoints(): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const endpoints = config.get<string[]>('endpoints');
  if (endpoints && endpoints.length > 0) {
    return endpoints.filter((e) => e.trim().length > 0);
  }
  return [getBaseUrl()];
}

/**
 * Resolve the API model ID to send to the endpoint.
 *
 * Picker IDs are made source-unique (e.g. `glm-5.2@z-ai`) so models with the
 * same ID from different endpoints don't collide in VS Code's picker. Before
 * sending the request we strip the `@source` suffix back to the real API model
 * ID. Users can still override via `modelIdOverrides` (matched on the full
 * picker ID, suffix included).
 */
export function getApiModelId(vscodeModelId: string): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const overrides = config.get<Record<string, string>>('modelIdOverrides');
  const override = overrides?.[vscodeModelId]?.trim();
  if (override) {
    return override;
  }
  // Strip the source suffix: `glm-5.2@z-ai` → `glm-5.2`
  const atIndex = vscodeModelId.lastIndexOf('@');
  const plainId = atIndex > 0 ? vscodeModelId.slice(0, atIndex) : vscodeModelId;
  // Backward compatibility: honor overrides keyed by the plain (unsuffixed)
  // model ID, as users configured them before source-unique IDs existed.
  const legacyOverride = overrides?.[plainId]?.trim();
  return legacyOverride || plainId;
}

/** Get the configured max output tokens limit. Returns undefined when 0 (no limit). */
export function getMaxTokens(): number | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const value = config.get<number>('maxTokens', 0);
  return value > 0 ? value : undefined;
}

/**
 * Get the API key map (endpoint URL → Bearer token).
 * Used for cloud providers like z.ai that require authentication.
 */
export function getApiKeys(): Record<string, string> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<Record<string, string>>('apiKeys') ?? {};
}

/**
 * Get the API key for a specific endpoint URL, if configured.
 * Matches by normalized URL (trailing slashes stripped).
 */
export function getApiKeyForEndpoint(endpoint: string): string | undefined {
  const keys = getApiKeys();
  const normalized = endpoint.replace(/\/+$/, '');
  // Try exact match first
  if (keys[normalized]) return keys[normalized];
  // Try with trailing slash variants
  for (const [key, value] of Object.entries(keys)) {
    if (key.replace(/\/+$/, '') === normalized) return value;
  }
  return undefined;
}

/** Diagnostic mode. */
export function getDebugMode(): 'minimal' | 'metadata' | 'verbose' {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const mode = config.get<string>('debugMode', 'minimal');
  if (mode === 'metadata' || mode === 'verbose') {
    return mode;
  }
  return 'minimal';
}

/** Whether to log privacy-preserving diagnostic debug information. */
export function getDebugLoggingEnabled(): boolean {
  return getDebugMode() !== 'minimal';
}

/** Whether to write full request payloads to disk. */
export function getRequestDumpEnabled(): boolean {
  return getDebugMode() === 'verbose';
}

/** Get the configured vision model ID (empty = auto-detect). */
export function getVisionModelId(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string>('visionModel', '') || '';
}

/** Get the custom vision prompt (empty = default). */
export function getVisionPrompt(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string>('visionPrompt', '') || '';
}

/** Get the request timeout in milliseconds. Clamped to 5s–1h for safety. */
export function getRequestTimeoutMs(): number {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const value = config.get<number>('requestTimeoutMs', 120_000);
  return Math.max(5_000, Math.min(value, 3_600_000));
}
