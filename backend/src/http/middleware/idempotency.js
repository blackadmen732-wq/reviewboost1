import { badRequest } from '../errors.js';
import { idempotencyKeySchema } from '../schemas.js';

/**
 * Require a usable `Idempotency-Key` on a public mutation.
 *
 * The header is mandatory rather than optional because the customer flow runs
 * on a phone in a restaurant: the request that times out is the normal case,
 * not the exceptional one, and a retry without a key would text a second
 * response, a second praise record, or a second scan into the business's data.
 *
 * The key is a *correlation* value, never an authorisation one. Holding a key
 * grants nothing; it only identifies which attempt this is.
 */
export function requireIdempotencyKey(req, _res, next) {
  const parsed = idempotencyKeySchema.safeParse(req.get('idempotency-key') ?? '');

  if (!parsed.success) {
    return next(
      badRequest('idempotency_key_required', 'A valid Idempotency-Key header is required.', [
        { field: 'Idempotency-Key', message: parsed.error.issues[0]?.message ?? 'Invalid.' },
      ]),
    );
  }

  req.idempotencyKey = parsed.data;
  return next();
}
