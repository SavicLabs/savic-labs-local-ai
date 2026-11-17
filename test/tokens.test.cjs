'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVscode, install } = require('./helpers/vscode.cjs');

const vscode = createVscode();
install(vscode);

const {
  estimateTokenCount,
  estimateTokensFromChars,
  updateCharsPerToken,
} = require('../out/provider/tokens.js');

const {
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  LanguageModelThinkingPart,
  LanguageModelPromptTsxPart,
} = vscode;

const message = (...content) => ({ role: 1, content });
const REPLAY_MARKER_MIME = 'x-application/saviclabs-replay-marker';

test('empty text is zero tokens', () => {
  assert.equal(estimateTokenCount('', 4), 0);
  assert.equal(estimateTokensFromChars(0, 4), 0);
});

test('estimates scale with text length', () => {
  assert.equal(estimateTokenCount('abcd', 4), 1);
  assert.equal(estimateTokenCount('a'.repeat(400), 4), 100);
  assert.ok(estimateTokenCount('a'.repeat(1000), 4) > estimateTokenCount('a'.repeat(500), 4));
});

test('never returns less than one token for non-empty input', () => {
  assert.equal(estimateTokenCount('a', 100), 1);
  assert.equal(estimateTokensFromChars(1, 100), 1);
});

test('estimateTokensFromChars uses the character count, not its digits', () => {
  // Regression: passing a number through the string-based estimator measured
  // the digits of the number, so 50,000 characters estimated as 2 tokens.
  assert.equal(estimateTokensFromChars(50_000, 4), 12_500);
  assert.equal(estimateTokenCount(String(50_000), 4), 2);
});

test('chars-per-token calibration moves toward the observed ratio', () => {
  // observed = 1000 chars / 200 tokens = 5; EMA = 4*0.7 + 5*0.3 = 4.3
  assert.ok(Math.abs(updateCharsPerToken(1000, 200, 4) - 4.3) < 1e-9);
});

test('calibration is a no-op without usable data', () => {
  assert.equal(updateCharsPerToken(0, 0, 4), 4);
  assert.equal(updateCharsPerToken(1000, 0, 4), 4);
});

// ---- Message content parts -------------------------------------------------
// Regression: provideTokenCount used to count only LanguageModelTextPart, so
// tool-heavy agent conversations appeared nearly empty and never compacted.

test('text parts are counted in a message', () => {
  assert.equal(estimateTokenCount(message(new LanguageModelTextPart('a'.repeat(400))), 4), 100);
});

test('tool calls are counted, including call id, name and arguments', () => {
  const msg = message(new LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.ts' }));
  // 6 (callId) + 9 (name) + 15 (JSON arguments) = 30 chars -> 8 tokens
  assert.equal(estimateTokenCount(msg, 4), 8);
});

test('tool results are counted, not treated as zero', () => {
  const msg = message(
    new LanguageModelToolResultPart('call-1', [new LanguageModelTextPart('x'.repeat(4000))])
  );
  assert.ok(
    estimateTokenCount(msg, 4) >= 1000,
    `expected a large estimate, got ${estimateTokenCount(msg, 4)}`
  );
});

test('nested prompt-tsx content inside tool results is counted', () => {
  const msg = message(
    new LanguageModelToolResultPart('call-1', [
      new LanguageModelPromptTsxPart({ text: 'y'.repeat(400) }),
    ])
  );
  assert.ok(estimateTokenCount(msg, 4) > 50, `got ${estimateTokenCount(msg, 4)}`);
});

test('thinking parts are counted for string and string[] values', () => {
  assert.equal(estimateTokenCount(message(new LanguageModelThinkingPart('z'.repeat(400))), 4), 100);
  assert.equal(
    estimateTokenCount(
      message(new LanguageModelThinkingPart(['z'.repeat(200), 'z'.repeat(200)])),
      4
    ),
    100
  );
});

test('image data parts use a fixed token cost', () => {
  const msg = message(new LanguageModelDataPart(new Uint8Array(50_000), 'image/png'));
  assert.equal(estimateTokenCount(msg, 4), 384);
});

test('replay markers charge for their payload (re-sent as reasoning_content)', () => {
  const msg = message(new LanguageModelDataPart(new Uint8Array(1000), REPLAY_MARKER_MIME));
  assert.equal(estimateTokenCount(msg, 4), 250);
});

test('unknown part types fall back to JSON length', () => {
  const msg = message({ weird: 'x'.repeat(400) });
  assert.ok(estimateTokenCount(msg, 4) > 50, `got ${estimateTokenCount(msg, 4)}`);
});

test('an empty message still reports at least one token', () => {
  assert.equal(estimateTokenCount({ role: 1, content: [] }, 4), 1);
});
