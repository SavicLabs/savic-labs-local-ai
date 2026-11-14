'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVscode, install } = require('./helpers/vscode.cjs');

const vscode = createVscode();
install(vscode);

const { checkContextWindow } = require('../out/provider/context.js');
const { LanguageModelTextPart, LanguageModelChatMessageRole } = vscode;

const SYSTEM = LanguageModelChatMessageRole.System;
const USER = LanguageModelChatMessageRole.User;
const ASSISTANT = LanguageModelChatMessageRole.Assistant;

const message = (role, text) => ({ role, content: [new LanguageModelTextPart(text)] });

// checkContextWindow reserves 4096 tokens for the response by default.
const MAX_INPUT = 16_384;

test('small conversations pass through untouched', () => {
  const messages = [message(SYSTEM, 'You are helpful.'), message(USER, 'Hi')];
  const result = checkContextWindow(messages, MAX_INPUT, 4);

  assert.equal(result.truncated, false);
  assert.equal(result.messages, messages);
  assert.equal(result.notice, undefined);
});

test('large conversations are estimated in real token magnitudes', () => {
  // Regression: the character count used to be stringified before estimation,
  // so ~41,000 characters measured as a single-digit token count and the
  // overflow guard never fired.
  const messages = [message(SYSTEM, 's'.repeat(1000))];
  for (let i = 0; i < 40; i++) {
    messages.push(message(USER, 'u'.repeat(2000)));
  }

  const result = checkContextWindow(messages, MAX_INPUT, 4);

  // ~81,000 characters is roughly 20,000 tokens, which must exceed the
  // 12,288-token budget (16,384 input minus the 4,096 response reserve).
  assert.ok(
    result.estimatedTokens > 1000,
    `expected a realistic estimate, got ${result.estimatedTokens}`
  );
  assert.equal(result.truncated, true);
});

test('truncation keeps the system message and the newest turn', () => {
  const messages = [message(SYSTEM, 'system prompt')];
  for (let i = 0; i < 30; i++) {
    messages.push(message(i % 2 === 0 ? USER : ASSISTANT, `turn ${i} `.repeat(500)));
  }

  const result = checkContextWindow(messages, MAX_INPUT, 4);

  assert.equal(result.truncated, true);
  assert.ok(result.messages.length < messages.length);
  assert.equal(result.messages[0].content[0].value, 'system prompt');
  assert.equal(
    result.messages[result.messages.length - 1].content[0].value,
    messages[messages.length - 1].content[0].value
  );
  assert.match(result.notice, /Dropped \d+ earlier messages/);
});

test('warns when context is close to full but not over', () => {
  // 16k input minus the 4096 reserve leaves 12,288 tokens ≈ 49,152 characters.
  const messages = [message(SYSTEM, 's'), message(USER, 'u'.repeat(47_000))];
  const result = checkContextWindow(messages, MAX_INPUT, 4);

  assert.equal(result.truncated, false);
  assert.ok(result.usagePercent > 90);
  assert.match(result.notice, /% full/);
});
