'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVscode, install, createExtensionContext } = require('./helpers/vscode.cjs');

const vscode = createVscode({
  apiKeys: {
    'https://api.z.ai/api/paas/v4/': 'legacy-key',
    'http://127.0.0.1:8080/v1': '   ',
  },
});
install(vscode);
const secrets = require('../out/secrets.js');

const SECRET_PREFIX = 'savicLabs.apiKey:';

test('normalizeEndpoint trims whitespace and trailing slashes', () => {
  assert.equal(secrets.normalizeEndpoint('  https://api.z.ai/v4//  '), 'https://api.z.ai/v4');
  assert.equal(secrets.normalizeEndpoint('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1');
});

test('legacy settings keys migrate to SecretStorage and the setting is removed', async () => {
  const context = createExtensionContext();
  await secrets.initApiKeyStore(context);

  assert.equal(secrets.getApiKeyForEndpoint('https://api.z.ai/api/paas/v4'), 'legacy-key');
  assert.equal(
    await context.secrets.get(`${SECRET_PREFIX}https://api.z.ai/api/paas/v4`),
    'legacy-key'
  );
  assert.equal('apiKeys' in vscode.__settings, false, 'plaintext setting should be deleted');
});

test('blank legacy keys are not migrated', async () => {
  const context = createExtensionContext();
  await secrets.initApiKeyStore(context);
  assert.equal(secrets.hasApiKey('http://127.0.0.1:8080/v1'), false);
});

test('endpoints without a key report none', async () => {
  await secrets.initApiKeyStore(createExtensionContext());
  assert.equal(secrets.getApiKeyForEndpoint('https://nothing.test/v1'), undefined);
});

test('set, reload from index, and delete round-trip', async () => {
  const context = createExtensionContext();
  await secrets.initApiKeyStore(context);

  await secrets.setApiKey('https://example.test/v1/', 'k1');
  assert.equal(secrets.getApiKeyForEndpoint('https://example.test/v1'), 'k1');

  // A restart re-reads the endpoint index and repopulates the in-memory cache.
  const restarted = createExtensionContext({
    secrets: context.secrets,
    globalState: context.globalState,
  });
  await secrets.initApiKeyStore(restarted);
  assert.equal(secrets.getApiKeyForEndpoint('https://example.test/v1'), 'k1');

  await secrets.deleteApiKey('https://example.test/v1');
  assert.equal(secrets.hasApiKey('https://example.test/v1'), false);
});

test('an existing secret is not overwritten by a stale settings value', async () => {
  const context = createExtensionContext();
  await context.secrets.store(`${SECRET_PREFIX}https://kept.test/v1`, 'from-secret');
  vscode.__settings.apiKeys = { 'https://kept.test/v1': 'stale-plaintext' };

  await secrets.initApiKeyStore(context);

  assert.equal(secrets.getApiKeyForEndpoint('https://kept.test/v1'), 'from-secret');
  delete vscode.__settings.apiKeys;
});

test('when secure storage fails, the migration leaves the plaintext setting intact', async () => {
  // A headless Linux session with no keyring can throw from secrets.store().
  // The credential must not be thrown away in that case, and activation must
  // still be able to continue.
  const context = createExtensionContext();
  vscode.__settings.apiKeys = { 'https://failing.test/v1': 'must-survive' };
  context.secrets.store = async () => {
    throw new Error('no keyring available');
  };

  await secrets.initApiKeyStore(context);

  assert.equal(
    vscode.__settings.apiKeys['https://failing.test/v1'],
    'must-survive',
    'the key must still be readable from settings'
  );
  delete vscode.__settings.apiKeys;
});
