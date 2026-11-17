'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVscode, install } = require('./helpers/vscode.cjs');

const vscode = createVscode();
install(vscode);

const { measureContextUsage, ContextOverflowError } = require('../out/provider/context.js');
const { LanguageModelTextPart, LanguageModelToolResultPart, LanguageModelChatMessageRole } = vscode;

const SYSTEM = LanguageModelChatMessageRole.System;
const USER = LanguageModelChatMessageRole.User;

const message = (role, text) => ({ role, content: [new LanguageModelTextPart(text)] });

// measureContextUsage takes the usable input budget directly (the model's
// context window minus the response reserve).
const MAX_INPUT = 16_384;
const BUDGET = MAX_INPUT;

test('small conversations fit', () => {
  const messages = [message(SYSTEM, 'You are helpful.'), message(USER, 'Hi')];
  const usage = measureContextUsage(messages, MAX_INPUT, 4);

  assert.equal(usage.fits, true);
  assert.equal(usage.maxInputTokens, BUDGET);
  assert.ok(usage.estimatedTokens > 0);
  assert.ok(usage.usagePercent < 100);
});

test('large conversations are estimated in real token magnitudes', () => {
  // Regression: the character count used to be stringified before estimation,
  // so ~81,000 characters measured as a single-digit token count and the
  // overflow guard never fired.
  const messages = [message(SYSTEM, 's'.repeat(1000))];
  for (let i = 0; i < 40; i++) {
    messages.push(message(USER, 'u'.repeat(2000)));
  }

  const usage = measureContextUsage(messages, MAX_INPUT, 4);

  assert.ok(usage.estimatedTokens > 1000, `expected a realistic estimate, got ${usage.estimatedTokens}`);
  assert.equal(usage.fits, false);
  assert.ok(usage.usagePercent > 100);
});

test('tool results count toward the budget', () => {
  // Regression: tool results were invisible to provideTokenCount / the guard,
  // so a tool-heavy agent conversation looked nearly empty.
  const messages = [
    message(SYSTEM, 'system'),
    {
      role: USER,
      content: [
        new LanguageModelToolResultPart('call-1', [
          new LanguageModelTextPart('x'.repeat(100_000)),
        ]),
      ],
    },
  ];

  const usage = measureContextUsage(messages, MAX_INPUT, 4);

  assert.ok(usage.estimatedTokens >= 15_000, `got ${usage.estimatedTokens}`);
  assert.equal(usage.fits, false);
});

test('tool definitions sent outside the message list count via extraChars', () => {
  const messages = [message(USER, 'u'.repeat(40_000))];
  const withoutTools = measureContextUsage(messages, MAX_INPUT, 4);
  const withTools = measureContextUsage(messages, MAX_INPUT, 4, { extraChars: 40_000 });

  assert.equal(withoutTools.fits, true);
  assert.equal(withTools.fits, false);
  assert.equal(withTools.estimatedTokens - withoutTools.estimatedTokens, 10_000);
});

test('overflow error carries usage and a helpful message', () => {
  const usage = measureContextUsage([message(USER, 'u'.repeat(100_000))], MAX_INPUT, 4);
  const error = new ContextOverflowError('Qwen3.8 27B', usage);

  assert.equal(error.name, 'ContextOverflowError');
  assert.equal(error.usage, usage);
  assert.match(error.message, /Qwen3\.8 27B/);
  assert.match(error.message, /Compact Conversation/);
});
