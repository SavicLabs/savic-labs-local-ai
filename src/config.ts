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
 * Users can override model IDs via the `modelIdOverrides` setting object.
 */
export function getApiModelId(vscodeModelId: string): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const overrides = config.get<Record<string, string>>('modelIdOverrides');
  const override = overrides?.[vscodeModelId]?.trim();
  return override || vscodeModelId;
}

/** Get the configured max output tokens limit. Returns undefined when 0 (no limit). */
export function getMaxTokens(): number | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const value = config.get<number>('maxTokens', 0);
  return value > 0 ? value : undefined;
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

/** Whether experimental tool list stabilization is enabled. */
export function getStabilizeToolListEnabled(): boolean {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<boolean>('experimental.stabilizeToolList', false);
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

/** Get the request timeout in milliseconds. */
export function getRequestTimeoutMs(): number {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<number>('requestTimeoutMs', 120_000);
}
