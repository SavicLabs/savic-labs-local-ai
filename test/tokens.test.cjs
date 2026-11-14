'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { estimateTokenCount, estimateTokensFromChars, updateCharsPerToken } = require('../out/provider/tokens.js');

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
