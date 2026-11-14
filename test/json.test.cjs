'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safeStringify } = require('../out/json.js');

test('serializes plain objects with indentation', () => {
  assert.equal(safeStringify({ a: 1 }, 2), '{\n  "a": 1\n}');
});

test('converts BigInt to a string instead of throwing', () => {
  assert.equal(safeStringify({ big: 10n }), '{"big":"10"}');
});

test('does not throw on circular structures', () => {
  const value = { name: 'root' };
  value.self = value;
  assert.doesNotThrow(() => safeStringify(value));
});

test('handles top-level undefined', () => {
  assert.equal(safeStringify(undefined), undefined);
});
