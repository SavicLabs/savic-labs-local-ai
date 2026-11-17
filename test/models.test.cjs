'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVscode, install } = require('./helpers/vscode.cjs');

install(createVscode());
const { toModelPickerId, toChatInfo, computeLocalResponseReserve } = require('../out/provider/models.js');

function discovered(overrides = {}) {
  return {
    id: 'qwen3.6:27b',
    displayName: 'Qwen3.6 27B',
    detail: 'llama.cpp · Q4_K_M',
    maxInputTokens: 32_768,
    maxOutputTokens: 4096,
    contextWindowTokens: 36_864,
    hasThinking: true,
    hasVision: false,
    isLoaded: true,
    isFailed: false,
    specType: 'draft-mtp',
    quantType: 'Q4_K_M',
    sourceUrl: 'http://127.0.0.1:18080/v1',
    sourceLabel: 'llama.cpp',
    isCloud: false,
    ...overrides,
  };
}

test('picker IDs are namespaced by source', () => {
  assert.equal(toModelPickerId({ id: 'qwen3', sourceLabel: 'ollama' }), 'qwen3@ollama');
});

test('the same model ID from two providers gets distinct picker IDs', () => {
  // Regression for the 0.10.2 collision: z.ai and Verboo both serve glm-5.2.
  const zai = toModelPickerId({ id: 'glm-5.2', sourceLabel: 'z-ai' });
  const verboo = toModelPickerId({ id: 'glm-5.2', sourceLabel: 'verboo' });

  assert.notEqual(zai, verboo);
  assert.equal(new Set([zai, verboo]).size, 2);
});

test('chat info carries the picker ID and declared limits', () => {
  const info = toChatInfo(discovered());

  assert.equal(info.id, 'qwen3.6:27b@llama.cpp');
  assert.equal(info.name, 'Qwen3.6 27B');
  assert.equal(info.maxInputTokens, 32_768);
  assert.equal(info.maxOutputTokens, 4096);
  assert.equal(info.capabilities.imageInput, false);
  assert.ok(info.configurationSchema, 'picker configuration should be provided');
});

test('picker context options leave room for the response', () => {
  const info = toChatInfo(discovered({
    maxInputTokens: 253_952,
    maxOutputTokens: 8_192,
    contextWindowTokens: 262_144,
  }));
  const ctx = info.configurationSchema.properties.maxContextTokens;

  assert.ok(ctx.enum.includes('253952'), 'the input budget should be selectable');
  assert.ok(!ctx.enum.includes('262144'), 'the full window must not be offered as input');
  assert.match(ctx.description, /256K/);
  assert.match(ctx.description, /reserved for the response/);
});

test('response reserve scales with the window and stays bounded', () => {
  // 1/16 of the window, clamped to [8K, 32K] and <= 25% of the window.
  assert.equal(computeLocalResponseReserve(262_144), 16_384);
  assert.equal(computeLocalResponseReserve(1_048_576), 32_768);
  assert.equal(computeLocalResponseReserve(131_072), 8_192);
  assert.equal(computeLocalResponseReserve(32_768), 8_192);
  assert.equal(computeLocalResponseReserve(4_096), 1_024);
});

test('thinking capability is advertised for reasoning models', () => {
  assert.equal(toChatInfo(discovered({ hasThinking: true })).capabilities.thinking, true);
  assert.equal(toChatInfo(discovered({ hasThinking: false })).capabilities.thinking, undefined);
});

test('a failed model is flagged and does not advertise thinking', () => {
  const info = toChatInfo(discovered({ isFailed: true, hasThinking: true }));

  assert.equal(info.tooltip, 'This model failed to load on the server. Restart your llama.cpp router to retry.');
  assert.equal(info.statusIcon?.id, 'warning');
  assert.equal(info.capabilities.thinking, undefined, 'a failed model must not offer thinking');
});

test('reasoning effort is read from the picker configuration', () => {
  const { getConfiguredThinkingEffort } = require('../out/provider/models.js');

  assert.equal(getConfiguredThinkingEffort({ modelOptions: { reasoningEffort: 'none' } }), 'none');
  assert.equal(getConfiguredThinkingEffort({ modelOptions: { reasoningEffort: 'high' } }), 'high');
  assert.equal(getConfiguredThinkingEffort({ modelOptions: { reasoningEffort: 'max' } }), 'max');
  // Unset or unrecognised values fall back to the default effort. This is only
  // applied for models detected as thinking models.
  assert.equal(getConfiguredThinkingEffort({}), 'high');
  assert.equal(getConfiguredThinkingEffort({ modelOptions: { reasoningEffort: 'bogus' } }), 'high');
});
