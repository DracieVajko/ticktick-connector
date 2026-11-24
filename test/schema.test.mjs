import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAgainst } from '../src/schema.mjs';

const passes = (schema, value) => validateAgainst(schema, value, 'args');
const fails = (schema, value, pattern) => assert.throws(() => validateAgainst(schema, value, 'args'), pattern);

test('declared types, enums and limits are enforced', () => {
  passes({ type: 'string', minLength: 1, maxLength: 3 }, 'abc');
  fails({ type: 'string', minLength: 2 }, 'a', /at least 2/);
  fails({ type: 'integer', minimum: 1, maximum: 5 }, 0, /at least 1/);
  fails({ type: 'string', enum: ['a', 'b'] }, 'c', /must be one of/);
  fails({ type: 'boolean' }, 'yes', /must be boolean/);
});

test('oneOf requires exactly one match, anyOf requires one', () => {
  const union = { oneOf: [{ type: 'integer' }, { type: 'number' }] };
  // An integer is also a number: two branches match, so the value is ambiguous.
  fails(union, 3, /exactly one/);
  passes(union, 3.5);
  passes({ anyOf: [{ type: 'string' }, { type: 'integer' }] }, 'x');
});

test('unknown keys are refused only when additionalProperties is false', () => {
  const closed = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  fails(closed, { a: 'x', b: 1 }, /unknown key b/);
  passes({ type: 'object', properties: { a: { type: 'string' } } }, { a: 'x', b: 1 });
});

test('required keys and array items are checked', () => {
  const schema = {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 2 } },
    required: ['ids'],
    additionalProperties: false,
  };
  fails(schema, {}, /required/);
  fails(schema, { ids: ['a', 2] }, /must be string/);
  fails(schema, { ids: ['a', 'b', 'c'] }, /at most 2/);
  passes(schema, { ids: ['a', 'b'] });
});

test('an unsupported schema type is refused instead of silently accepted', () => {
  fails({ type: 'date' }, '2026-01-01', /unsupported schema type/);
});
