import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SMS_TEMPLATE,
  TemplateError,
  extractVariables,
  findUnsupportedVariables,
  hasUnresolvedPlaceholders,
  previewTemplate,
  renderTemplate,
  validateTemplate,
} from '../../src/domain/templates.js';

const FULL_CONTEXT = {
  customer_name: 'Sam',
  business_name: 'Joe\'s Pizza',
  review_link: 'https://g.page/r/example',
};

describe('renderTemplate', () => {
  it('substitutes every supported variable', () => {
    const body = renderTemplate(
      'Hi {{customer_name}}, review {{business_name}} at {{review_link}}',
      FULL_CONTEXT,
    );
    assert.equal(body, "Hi Sam, review Joe's Pizza at https://g.page/r/example");
  });

  it('tolerates whitespace inside the braces', () => {
    assert.equal(renderTemplate('Hi {{ customer_name }}', FULL_CONTEXT), 'Hi Sam');
  });

  it('substitutes a variable used more than once', () => {
    assert.equal(
      renderTemplate('{{customer_name}} and {{customer_name}}', FULL_CONTEXT),
      'Sam and Sam',
    );
  });

  it('falls back to the default template when given nothing', () => {
    const body = renderTemplate('', FULL_CONTEXT);
    assert.ok(body.includes('Sam'));
    assert.ok(!hasUnresolvedPlaceholders(body));
  });

  it('throws on an unknown variable instead of sending a broken message', () => {
    assert.throws(() => renderTemplate('Hi {{nope}}', FULL_CONTEXT), TemplateError);

    try {
      renderTemplate('Hi {{nope}}', FULL_CONTEXT);
    } catch (error) {
      assert.equal(error.variable, 'nope');
    }
  });

  it('throws when a supported variable has no value', () => {
    // "Hi , thanks for visiting" is worse than a failed send: it reaches a real
    // customer and still costs money.
    assert.throws(
      () => renderTemplate('Hi {{customer_name}}', { ...FULL_CONTEXT, customer_name: '' }),
      TemplateError,
    );
    assert.throws(() => renderTemplate('Hi {{customer_name}}', {}), TemplateError);
  });

  it('collapses stray spaces but preserves intentional line breaks', () => {
    const body = renderTemplate('Hi {{customer_name}}   there\nSecond line', FULL_CONTEXT);
    assert.equal(body, 'Hi Sam there\nSecond line');
  });

  it('trims whitespace around substituted values', () => {
    assert.equal(renderTemplate('Hi {{customer_name}}', { customer_name: '  Sam  ' }), 'Hi Sam');
  });

  it('does not HTML-escape — SMS is plain text', () => {
    // Escaping here would store "Joe&#x27;s Pizza" and send it verbatim.
    const body = renderTemplate('{{business_name}}', FULL_CONTEXT);
    assert.equal(body, "Joe's Pizza");
    assert.ok(!body.includes('&#'));
  });
});

describe('extractVariables', () => {
  it('lists variables in order of first appearance, without duplicates', () => {
    assert.deepEqual(
      extractVariables('{{review_link}} {{customer_name}} {{review_link}}'),
      ['review_link', 'customer_name'],
    );
  });

  it('is not affected by regex state between calls', () => {
    // A module-level /g regex would make the second call return a different
    // result than the first.
    const template = '{{customer_name}} {{business_name}}';
    assert.deepEqual(extractVariables(template), extractVariables(template));
  });

  it('returns the default template variables for empty input', () => {
    assert.ok(extractVariables('').includes('customer_name'));
  });
});

describe('validateTemplate', () => {
  it('accepts a well-formed template', () => {
    const result = validateTemplate('Hi {{customer_name}}, visit {{review_link}}');
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('rejects an empty template', () => {
    const result = validateTemplate('   ');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /empty/i.test(error)));
  });

  it('rejects an over-long template', () => {
    const result = validateTemplate('a'.repeat(1001));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /1000 characters/.test(error)));
  });

  it('names the unknown variable and lists the valid ones', () => {
    const result = validateTemplate('Hi {{first_name}}');
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('first_name'));
    assert.ok(result.errors[0].includes('customer_name'));
  });

  it('catches an unclosed brace', () => {
    const result = validateTemplate('Hi {{customer_name');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /unclosed|malformed/i.test(error)));
  });

  it('collects every problem rather than stopping at the first', () => {
    const result = validateTemplate(`{{bad_one}} {{bad_two}} ${'a'.repeat(1001)}`);
    assert.ok(result.errors.length >= 3);
  });
});

describe('previewTemplate', () => {
  it('fills placeholders so an author sees a realistic message', () => {
    const { body, error } = previewTemplate('Hi {{customer_name}} from {{business_name}}');
    assert.equal(error, null);
    assert.ok(body.includes('Alex'));
    assert.ok(body.includes('Your Business'));
  });

  it('returns an error string rather than throwing mid-edit', () => {
    const { body, error } = previewTemplate('Hi {{typo_here}}');
    assert.equal(body, '');
    assert.match(error, /typo_here/);
  });

  it('lets supplied values override the placeholders', () => {
    const { body } = previewTemplate('Hi {{customer_name}}', { customer_name: 'Real Name' });
    assert.ok(body.includes('Real Name'));
  });
});

describe('findUnsupportedVariables', () => {
  it('returns only the unsupported ones', () => {
    assert.deepEqual(findUnsupportedVariables('{{nope}} {{customer_name}}'), ['nope']);
    assert.deepEqual(findUnsupportedVariables(DEFAULT_SMS_TEMPLATE), []);
  });
});

describe('hasUnresolvedPlaceholders', () => {
  it('detects a leftover placeholder', () => {
    assert.equal(hasUnresolvedPlaceholders('Hi {{customer_name}}'), true);
    assert.equal(hasUnresolvedPlaceholders('Hi Sam'), false);
  });

  it('returns the same answer on repeated calls', () => {
    const body = 'Hi {{customer_name}}';
    assert.equal(hasUnresolvedPlaceholders(body), hasUnresolvedPlaceholders(body));
  });
});
