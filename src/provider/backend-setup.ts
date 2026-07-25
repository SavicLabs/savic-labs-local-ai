/**
 * Backend Configuration — user-friendly multi-server setup.
 *
 * Replaces the single-URL input box with a guided quick-pick experience:
 *   - Pre-configured backends (Ollama, llama.cpp, vLLM) with default ports
 *   - Auto-detection of running backends via health check
 *   - Add/remove multiple endpoints
 *   - Clear status indicators and confirmation messages
 */
import * as vscode from 'vscode';

/** Known backend presets — easiest path for new users. */
interface BackendPreset {
  label: string;
  description: string;
  detail: string;
  defaultUrl: string;
  checkPath: string; // Health-check endpoint
  icon: string;
}

const PRESETS: BackendPreset[] = [
  {
    label: '$(server) Ollama',
    description: 'Most popular local AI',
    detail: 'Pull models with `ollama pull qwen3.6`. Easiest setup.',
    defaultUrl: 'http://127.0.0.1:11434/v1',
    checkPath: '/api/tags',
    icon: '🦙',
  },
  {
    label: '$(server) llama.cpp Router',
    description: 'Multi-model, on-demand loading',
    detail: 'Aggregates multiple GGUF models on one port. Best for power users.',
    defaultUrl: 'http://127.0.0.1:18080/v1',
    checkPath: '/v1/models',
    icon: '🦙',
  },
  {
    label: '$(server) llama.cpp Server',
    description: 'Single model, simple setup',
    detail: 'One GGUF model loaded at a time. Fast and minimal.',
    defaultUrl: 'http://127.0.0.1:8080/v1',
    checkPath: '/v1/models',
    icon: '🦙',
  },
  {
    label: '$(server) vLLM',
    description: 'High-throughput production serving',
    detail: 'Optimized for multi-user, high-concurrency inference.',
    defaultUrl: 'http://127.0.0.1:8000/v1',
    checkPath: '/v1/models',
    icon: '⚡',
  },
];

/**
 * Result of a backend health check.
 */
interface HealthStatus {
  reachable: boolean;
  latencyMs: number;
  modelCount?: number;
}

/**
 * Show the main backend configuration quick pick.
 * Lets users select a preset, add custom URLs, or remove endpoints.
 */
export async function showBackendConfig(currentEndpoints: string[]): Promise<string[] | undefined> {
  // Build items list
  const items: vscode.QuickPickItem[] = [];

  // Show existing endpoints first (if any)
  if (currentEndpoints.length > 0) {
    items.push({
      label: 'Configured Backends',
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const url of currentEndpoints) {
      const label = identifyBackend(url);
      items.push({
        label: `$(pass) ${label}`,
        description: url,
        detail: 'Click to remove',
      });
    }
  }

  // Presets
  items.push({
    label: 'Quick Setup',
    kind: vscode.QuickPickItemKind.Separator,
  });
  for (const preset of PRESETS) {
    items.push({
      label: preset.label,
      description: preset.description,
      detail: `${preset.defaultUrl} — ${preset.detail}`,
    });
  }

  items.push({
    label: 'Advanced',
    kind: vscode.QuickPickItemKind.Separator,
  });
  items.push({
    label: '$(add) Custom Endpoint...',
    description: 'Any OpenAI-compatible API',
    detail: 'Enter your own URL for TGWebUI, LM Studio, remote servers, etc.',
  });
  items.push({
    label: '$(settings-gear) Open Settings JSON',
    description: 'Edit savicLabs.endpoints directly',
    detail: 'For advanced configuration and manual editing',
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: currentEndpoints.length > 0
      ? `${currentEndpoints.length} backend(s) configured — select to add or remove`
      : 'Set up your first AI backend',
    matchOnDescription: true,
  });

  if (!pick) return undefined;

  // Handle "Configured Backends" removal
  if (pick.label.startsWith('$(pass)')) {
    const toRemove = pick.description; // The URL
    const updated = currentEndpoints.filter((e) => e !== toRemove);
    void vscode.window.showInformationMessage(
      `Removed ${toRemove}. ${updated.length} backend(s) remaining. Refresh models to update.`
    );
    return updated;
  }

  // Handle presets
  for (const preset of PRESETS) {
    if (pick.label === preset.label) {
      return await handlePresetSelection(preset, currentEndpoints);
    }
  }

  // Handle custom endpoint
  if (pick.label.startsWith('$(add)')) {
    return await handleCustomEndpoint(currentEndpoints);
  }

  // Handle settings JSON
  if (pick.label.startsWith('$(settings-gear)')) {
    const config = vscode.workspace.getConfiguration('savicLabs');
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'savicLabs.endpoints'
    );
    void vscode.window.showInformationMessage(
      'Edit the "SavicLabs > Endpoints" array. Then run "Refresh Models".'
    );
    return undefined;
  }

  return undefined;
}

async function handlePresetSelection(
  preset: BackendPreset,
  currentEndpoints: string[]
): Promise<string[] | undefined> {
  // Check if already added
  if (currentEndpoints.includes(preset.defaultUrl)) {
    void vscode.window.showInformationMessage(
      `${preset.label.replace('$(server) ', '')} is already configured at ${preset.defaultUrl}.`
    );
    return undefined;
  }

  // Offer to customize the URL
  const customUrl = await vscode.window.showInputBox({
    prompt: `${preset.icon} ${preset.label.replace('$(server) ', '')} endpoint URL`,
    placeHolder: preset.defaultUrl,
    value: preset.defaultUrl,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value?.trim()) return 'URL cannot be empty.';
      try { new URL(value); return undefined; } catch { return 'Invalid URL format.'; }
    },
  });

  if (!customUrl) return undefined;

  // Quick health check (non-blocking, fire-and-forget)
  checkBackendHealth(preset, customUrl.trim());

  const updated = [...currentEndpoints, customUrl.trim()];
  void vscode.window.showInformationMessage(
    `✅ ${preset.label.replace('$(server) ', '')} added: ${customUrl.trim()}. ` +
    `Run "Refresh Models" to discover models.`
  );
  return updated;
}

async function handleCustomEndpoint(
  currentEndpoints: string[]
): Promise<string[] | undefined> {
  const customUrl = await vscode.window.showInputBox({
    prompt: 'Enter the /v1 base URL of your OpenAI-compatible API',
    placeHolder: 'http://127.0.0.1:1234/v1',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value?.trim()) return 'URL cannot be empty.';
      try { new URL(value); return undefined; } catch { return 'Invalid URL format. Example: http://127.0.0.1:1234/v1'; }
    },
  });

  if (!customUrl) return undefined;

  const updated = [...currentEndpoints, customUrl.trim()];
  void vscode.window.showInformationMessage(
    `✅ Custom endpoint added: ${customUrl.trim()}. Run "Refresh Models" to discover models.`
  );
  return updated;
}

/**
 * Quick health check — pings the backend to see if it's reachable.
 * Shows a brief notification with the result.
 */
async function checkBackendHealth(preset: BackendPreset, url: string): Promise<void> {
  const baseUrl = url.replace(/\/+$/, '');
  const checkUrl = preset.checkPath.startsWith('/api')
    ? baseUrl.replace(/\/v1$/, '') + preset.checkPath
    : `${baseUrl}${preset.checkPath}`;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(checkUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const latency = Date.now() - start;

    if (response.ok) {
      void vscode.window.showInformationMessage(
        `🟢 ${preset.label.replace('$(server) ', '')} is reachable (${latency}ms). Ready to use!`
      );
    } else {
      void vscode.window.showWarningMessage(
        `🟡 ${preset.label.replace('$(server) ', '')} responded with HTTP ${response.status}. May need configuration.`
      );
    }
  } catch {
    // Don't show error — backend might genuinely be offline
    void vscode.window.showWarningMessage(
      `🔴 ${preset.label.replace('$(server) ', '')} is not reachable at ${url}. Make sure the server is running.`
    );
  }
}

/**
 * Try to identify a backend by its URL for display purposes.
 */
function identifyBackend(url: string): string {
  if (url.includes('11434')) return 'Ollama';
  if (url.includes('18080')) return 'llama.cpp Router';
  if (url.includes('8080')) return 'llama.cpp Server';
  if (url.includes('8000')) return 'vLLM';
  if (url.includes('1234')) return 'LM Studio';
  if (url.includes('5000')) return 'TGWebUI';
  return 'Custom';
}

/**
 * Check all configured backends and return their health statuses.
 * Useful for a dashboard view (future feature).
 */
export async function checkAllBackendsHealth(endpoints: string[]): Promise<Map<string, HealthStatus>> {
  const results = new Map<string, HealthStatus>();
  const checks = endpoints.map(async (url) => {
    const baseUrl = url.replace(/\/+$/, '');
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${baseUrl}/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        results.set(url, {
          reachable: true,
          latencyMs: Date.now() - start,
          modelCount: data?.data?.length ?? 0,
        });
      } else {
        results.set(url, { reachable: false, latencyMs: Date.now() - start });
      }
    } catch {
      results.set(url, { reachable: false, latencyMs: Date.now() - start });
    }
  });
  await Promise.allSettled(checks);
  return results;
}
