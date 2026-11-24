import { TickTickError } from './core.mjs';

// A small JSON Schema subset validator, kept apart from the tool catalogue so
// the contract check can be read, tested and changed on its own.

const TYPE_CHECKS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  null: (value) => value === null,
};

function schemaError(path, message) {
  return new TickTickError(`${path || 'arguments'} ${message}`, { code: 'TICKTICK_INVALID_ARGUMENTS' });
}

/**
 * Small JSON Schema subset validator, so a declared contract (types, enums,
 * limits, required keys) is enforced at call time instead of only being
 * described to the host.
 */
export function validateAgainst(schema, value, path) {
  if (!schema || typeof schema !== 'object') return;

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((option) => {
      try {
        validateAgainst(option, value, path);
        return true;
      } catch {
        return false;
      }
    }).length;
    // oneOf means exactly one: a value matching two shapes is ambiguous, not valid.
    if (matches !== 1) {
      throw schemaError(path, `must match exactly one of the allowed shapes (${matches} matched).`);
    }
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((option) => {
      try {
        validateAgainst(option, value, path);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) throw schemaError(path, 'does not satisfy any of the required options.');
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const unknown = types.filter((type) => !TYPE_CHECKS[type]);
    if (unknown.length) {
      throw schemaError(path, `uses an unsupported schema type (${unknown.join(', ')}).`);
    }
    const ok = types.some((type) => TYPE_CHECKS[type](value));
    if (!ok) throw schemaError(path, `must be ${types.join(' or ')}.`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw schemaError(path, `must be one of: ${schema.enum.map(String).join(', ')}.`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw schemaError(path, `must be at least ${schema.minLength} characters.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw schemaError(path, `must be at most ${schema.maxLength} characters.`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw schemaError(path, `must be at least ${schema.minimum}.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw schemaError(path, `must be at most ${schema.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw schemaError(path, `must contain at least ${schema.minItems} item(s).`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw schemaError(path, `must contain at most ${schema.maxItems} item(s).`);
    }
    if (schema.items) {
      value.forEach((entry, index) => validateAgainst(schema.items, entry, `${path}[${index}]`));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) throw schemaError(path, `is missing the required key ${key}.`);
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties[key]) {
        validateAgainst(schema.properties[key], entry, path ? `${path}.${key}` : key);
      } else if (schema.additionalProperties === false) {
        throw schemaError(
          path,
          `has an unknown key ${key}. Supported: ${Object.keys(schema.properties).join(', ')}.`,
        );
      }
    }
  }
}
