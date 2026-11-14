/**
 * API key storage.
 *
 * Keys are held in VS Code's SecretStorage (OS keychain / encrypted store), not
 * in `settings.json`. Earlier versions wrote them to the `savicLabs.apiKeys`
 * setting, which put bearer tokens in plain text in a file that is often
 * synced and committed by accident. That setting is migrated on activation and
 * then removed.
 *
 * SecretStorage cannot enumerate its keys, so the set of endpoints that have a
 * key is tracked separately in `globalState` (endpoint URLs are not secrets).
 * Values are cached in memory at activation so lookups stay synchronous for the
 * request path.
 */
import * as vscode from 'vscode';
import { CONFIG_SECTION } from './consts';
import { logger } from './logger';

const SECRET_PREFIX = 'savicLabs.apiKey:';
const INDEX_KEY = 'savicLabs.apiKeyEndpoints';

const cache = new Map<string, string>();
let storage: vscode.SecretStorage | undefined;
let memento: vscode.Memento | undefined;
let indexedEndpoints: string[] = [];

/** Canonical form used for both the secret key and the index. */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function secretKey(endpoint: string): string {
  return SECRET_PREFIX + normalizeEndpoint(endpoint);
}

/**
 * Move any keys left in the legacy `savicLabs.apiKeys` setting into
 * SecretStorage, then delete the setting. Existing keys win: a value already in
 * SecretStorage is not overwritten by a stale settings entry.
 */
async function migrateLegacySetting(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const legacy = config.get<Record<string, string>>('apiKeys');
  if (!legacy || typeof legacy !== 'object') {
    return;
  }

  const entries = Object.entries(legacy).filter(([, key]) => typeof key === 'string' && key.trim());
  if (entries.length === 0) {
    return;
  }

  for (const [endpoint, key] of entries) {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) continue;
    const existing = await context.secrets.get(secretKey(normalized));
    if (!existing) {
      await context.secrets.store(secretKey(normalized), key.trim());
      logger.info(`Migrated API key for ${normalized} to secure storage`);
    }
    if (!indexedEndpoints.includes(normalized)) {
      indexedEndpoints.push(normalized);
    }
  }

  await saveIndex();

  // Remove the plaintext copy. Workspace-level values are cleared too, since a
  // key committed in .vscode/settings.json is exactly what we are fixing.
  for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace]) {
    try {
      await config.update('apiKeys', undefined, target);
    } catch {
      // Workspace target is unavailable when no folder is open; ignore.
    }
  }
}

async function saveIndex(): Promise<void> {
  await memento?.update(INDEX_KEY, indexedEndpoints);
}

async function reloadCache(context: vscode.ExtensionContext): Promise<void> {
  cache.clear();
  for (const endpoint of indexedEndpoints) {
    const value = await context.secrets.get(secretKey(endpoint));
    if (value) {
      cache.set(endpoint, value);
    }
  }
}

/**
 * Load keys into memory and run the one-time settings migration. Must complete
 * before anything reads a key.
 */
export async function initApiKeyStore(context: vscode.ExtensionContext): Promise<void> {
  storage = context.secrets;
  memento = context.globalState;
  const stored = context.globalState.get<string[]>(INDEX_KEY);
  indexedEndpoints = Array.isArray(stored) ? [...stored] : [];

  await migrateLegacySetting(context);
  await reloadCache(context);

  context.subscriptions.push(
    context.secrets.onDidChange(async (e) => {
      if (!e.key.startsWith(SECRET_PREFIX)) return;
      const endpoint = e.key.slice(SECRET_PREFIX.length);
      const value = await context.secrets.get(e.key);
      if (value) {
        cache.set(endpoint, value);
      } else {
        cache.delete(endpoint);
      }
    })
  );
}

/** The API key configured for an endpoint, if any. */
export function getApiKeyForEndpoint(endpoint: string): string | undefined {
  return cache.get(normalizeEndpoint(endpoint));
}

/** Whether an endpoint has a stored key. */
export function hasApiKey(endpoint: string): boolean {
  return cache.has(normalizeEndpoint(endpoint));
}

/** Store (or replace) the key for an endpoint. */
export async function setApiKey(endpoint: string, key: string): Promise<void> {
  const normalized = normalizeEndpoint(endpoint);
  const trimmed = key.trim();
  if (!normalized || !trimmed || !storage) return;

  await storage.store(secretKey(normalized), trimmed);
  cache.set(normalized, trimmed);

  if (!indexedEndpoints.includes(normalized)) {
    indexedEndpoints.push(normalized);
    await saveIndex();
  }
}

/** Remove the key for an endpoint. */
export async function deleteApiKey(endpoint: string): Promise<void> {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized || !storage) return;

  await storage.delete(secretKey(normalized));
  cache.delete(normalized);

  if (indexedEndpoints.includes(normalized)) {
    indexedEndpoints = indexedEndpoints.filter((e) => e !== normalized);
    await saveIndex();
  }
}
