const assert = require('node:assert');
const vscode = require('vscode');

// Same module instance the extension loaded: both run in the extension host
// process, so this exposes the cache populated during activation.
const secrets = require('../../../out/secrets.js');

const LEGACY_ENDPOINT = 'https://migration.test/v1';
const LEGACY_KEY = 'legacy-secret-value';

suite('Local AI extension host', () => {
  test('activation succeeds', async () => {
    const extension = vscode.extensions.getExtension('SavicLabs.savic-labs-local-ai');
    assert.ok(extension, 'extension should be discoverable');
    await extension.activate();
    assert.ok(extension.isActive, 'extension should be active');
  });

  test('all contributed commands are registered', async () => {
    const registered = await vscode.commands.getCommands(true);
    const expected = [
      'savicLabs.configureEndpoint',
      'savicLabs.checkBackends',
      'savicLabs.refreshModels',
      'savicLabs.setVisionModel',
      'savicLabs.showLogs',
      'savicLabs.openRequestDumpsFolder',
    ];
    for (const command of expected) {
      assert.ok(registered.includes(command), `${command} should be registered`);
    }
  });

  test('language model provider answers for the SavicLabs vendor', async () => {
    // With no server running this returns no models, but the provider must
    // respond rather than throw.
    const models = await vscode.lm.selectChatModels({ vendor: 'SavicLabs' });
    assert.ok(Array.isArray(models), 'selectChatModels should resolve to an array');
  });

  test('upgrade: legacy plaintext API key is migrated to SecretStorage', () => {
    // The fixture workspace ships savicLabs.apiKeys containing LEGACY_KEY, so
    // activation exercised the real migration path.
    assert.equal(
      secrets.getApiKeyForEndpoint(LEGACY_ENDPOINT),
      LEGACY_KEY,
      'the credential must remain accessible after migration'
    );
    assert.equal(secrets.hasApiKey(LEGACY_ENDPOINT), true);
  });

  test('upgrade: the plaintext setting is removed only after migration', () => {
    const inspected = vscode.workspace.getConfiguration('savicLabs').inspect('apiKeys');
    const remaining = inspected?.workspaceValue ?? inspected?.globalValue;
    assert.equal(remaining, undefined, 'savicLabs.apiKeys should no longer be configured');
  });

  test('migrated credential is still scoped to its own endpoint', () => {
    assert.equal(
      secrets.getApiKeyForEndpoint('https://some-other.test/v1'),
      undefined,
      'a key must not leak to an unrelated endpoint'
    );
  });
});
