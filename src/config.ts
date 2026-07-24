/**
 * Runtime configuration reader.
 *
 * Reads extension settings from VS Code's workspace configuration.
 * All functions read live settings — no caching here (use caller-side caching if needed).
 */
import * as vscode from 'vscode';
import { CONFIG_SECTION, DEFAULT_BASE_URL } from './consts';

/** Get the API base URL from settings. Falls back to the default llama.cpp router URL. */
export function getBaseUrl(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string>('baseUrl') || DEFAULT_BASE_URL;
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
