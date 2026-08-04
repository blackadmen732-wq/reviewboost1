/**
 * SMS template rendering.
 *
 * Templates are author-controlled, but from the server's perspective they are
 * still untrusted input. An unknown variable is an *error*, never a silent
 * empty string: a message reading "Hi , thanks for visiting" damages the
 * sender's reputation with their own customer and still costs money to send.
 *
 * There is no HTML escaping here on purpose. SMS is plain text — escaping at
 * this layer would corrupt the stored body (turning `it's` into `it&#x27;s`).
 * Output encoding belongs at the point of rendering, not the point of storage.
 */

export const TEMPLATE_VARIABLES = Object.freeze([
  'customer_name',
  'business_name',
  'review_link',
]);

export const DEFAULT_SMS_TEMPLATE =
  'Hi {{customer_name}}, thanks for visiting {{business_name}}! ' +
  'Would you leave us a quick review? {{review_link}}';

export const MAX_TEMPLATE_LENGTH = 1000;

// Tolerates whitespace inside the braces: {{ customer_name }} works too.
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export class TemplateError extends Error {
  constructor(message, { variable = null } = {}) {
    super(message);
    this.name = 'TemplateError';
    this.variable = variable;
  }
}

export function normalizeTemplate(template) {
  const value = String(template ?? '').trim();
  return value || DEFAULT_SMS_TEMPLATE;
}

/** Every variable the template references, in order of first appearance. */
export function extractVariables(template) {
  const found = [];
  // matchAll on a fresh iteration avoids the lastIndex trap that makes a
  // module-level /g regex stateful between calls.
  for (const match of normalizeTemplate(template).matchAll(VARIABLE_PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/** Variables the template asks for that ReviewBoost cannot supply. */
export function findUnsupportedVariables(template) {
  const allowed = new Set(TEMPLATE_VARIABLES);
  return extractVariables(template).filter((name) => !allowed.has(name));
}

/**
 * Validate a template before it is ever used to send.
 *
 * Separated from rendering so the UI can show the author their mistake while
 * they are still editing, rather than at send time.
 *
 * @returns {{valid: boolean, errors: string[], variables: string[]}}
 */
export function validateTemplate(template) {
  const errors = [];
  const raw = String(template ?? '');

  if (!raw.trim()) {
    errors.push('Template cannot be empty.');
  }
  if (raw.length > MAX_TEMPLATE_LENGTH) {
    errors.push(`Template must be ${MAX_TEMPLATE_LENGTH} characters or fewer.`);
  }

  for (const name of findUnsupportedVariables(raw)) {
    errors.push(`Unknown variable {{${name}}}. Available: ${TEMPLATE_VARIABLES.join(', ')}.`);
  }

  // A lone or unbalanced brace is almost always a typo for a variable, and
  // would otherwise be sent to a customer verbatim.
  const withoutVariables = normalizeTemplate(raw).replace(VARIABLE_PATTERN, '');
  if (/\{\{|\}\}/.test(withoutVariables)) {
    errors.push('Template has an unclosed or malformed {{variable}}.');
  }

  return { valid: errors.length === 0, errors, variables: extractVariables(raw) };
}

/**
 * Render a template.
 *
 * @param {string} template
 * @param {Record<string, string>} variables
 * @throws {TemplateError} on an unknown variable, or a supported one with no value
 */
export function renderTemplate(template, variables = {}) {
  const normalized = normalizeTemplate(template);

  const unsupported = findUnsupportedVariables(normalized);
  if (unsupported.length > 0) {
    throw new TemplateError(`Template uses unsupported variable {{${unsupported[0]}}}.`, {
      variable: unsupported[0],
    });
  }

  const rendered = normalized.replace(VARIABLE_PATTERN, (_match, name) => {
    const value = variables[name];

    // A supported variable with nothing behind it is a data problem, not a
    // formatting one — surface it rather than shipping a gap in the message.
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new TemplateError(`No value supplied for {{${name}}}.`, { variable: name });
    }

    return String(value).trim();
  });

  return (
    rendered
      // Collapse runs of spaces and tabs, which substitution commonly leaves
      // behind, but preserve deliberate line breaks.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Render with placeholder values, for a live preview while editing.
 *
 * Never throws on a missing value — the author is mid-edit, and an exception
 * per keystroke is not a preview.
 */
export function previewTemplate(template, variables = {}) {
  const defaults = {
    customer_name: 'Alex',
    business_name: 'Your Business',
    review_link: 'https://g.page/r/example',
  };

  try {
    return { body: renderTemplate(template, { ...defaults, ...variables }), error: null };
  } catch (error) {
    if (error instanceof TemplateError) return { body: '', error: error.message };
    throw error;
  }
}

/** True when the rendered body still contains an unsubstituted placeholder. */
export function hasUnresolvedPlaceholders(body) {
  // Built fresh rather than reusing the module-level /g regex, whose lastIndex
  // would make repeated calls return alternating results.
  return /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(String(body ?? ''));
}
