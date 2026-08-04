import { MemoryStore } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { logger } from '../../logger.js';

/**
 * A rate-limit store that degrades rather than failing.
 *
 * Redis is the source of truth so limits hold across every instance — an
 * in-memory limiter on an autoscaled service multiplies the real limit by the
 * instance count.
 *
 * When Redis is unreachable there are two defensible policies, and which one is
 * right depends entirely on what is being protected:
 *
 *   fail-open   Ordinary API traffic. Counting falls back to per-process
 *               memory. Accuracy degrades; the product stays up.
 *
 *   fail-closed Authentication. The request is rejected. A memory fallback
 *               would hand an attacker `instances x` the brute-force budget,
 *               and a briefly unavailable sign-in page is a far smaller problem
 *               than an unbounded guessing window.
 */

/** How long to stop trying Redis after a failure. */
const CIRCUIT_OPEN_MS = 5000;

export class ResilientRateLimitStore {
  #redis;
  #memory;
  #prefix;
  #failClosed;
  // Retrying a dead Redis on every request wastes latency and produces a stream
  // of rejected promises, so failures open a short circuit instead.
  #circuitOpenUntil = 0;
  #reported = false;

  #sendCommand;
  #options;

  #isAvailable;

  constructor({ prefix, sendCommand, isAvailable, failClosed = false }) {
    this.#prefix = prefix;
    this.#failClosed = failClosed;
    this.#sendCommand = sendCommand;
    this.#isAvailable = isAvailable ?? (() => true);
    this.#memory = new MemoryStore();
    // RedisStore is NOT constructed here. Its constructor issues a command to
    // preload a Lua script, which throws synchronously when the connection has
    // enableOfflineQueue disabled — that would blow up at module load, before
    // any request, and take the whole process with it.
  }

  init(options) {
    this.#options = options;
    this.#memory.init?.(options);
  }

  /**
   * Build the Redis store on first use, and only once.
   *
   * Returns null when construction fails, which trips the circuit and routes
   * the operation to the fallback.
   */
  #getRedisStore() {
    if (this.#redis) return this.#redis;

    // RedisStore's constructor preloads a Lua script immediately. When the
    // connection is down that command rejects *inside* the library, where the
    // promise floats and cannot be caught. Constructing only once the
    // connection is genuinely ready avoids creating it at all.
    if (!this.#isAvailable()) return null;

    try {
      this.#redis = new RedisStore({
        prefix: `rl:${this.#prefix}:`,
        sendCommand: this.#sendCommand,
      });
      this.#redis.init?.(this.#options);
      return this.#redis;
    } catch (error) {
      this.#tripCircuit(error);
      return null;
    }
  }

  #tripCircuit(error) {
    this.#circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    if (!this.#reported) {
      this.#reported = true;
      logger.error('ratelimit.redis_unavailable', {
        prefix: this.#prefix,
        failClosed: this.#failClosed,
        message: error?.message,
      });
    }
  }

  #degraded(operation, args, error) {
    if (this.#failClosed) {
      const failure = new Error(`Rate limit store unavailable for "${this.#prefix}".`);
      failure.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
      failure.cause = error;
      throw failure;
    }
    return this.#memory[operation](...args);
  }

  async #withFallback(operation, ...args) {
    if (Date.now() < this.#circuitOpenUntil) {
      return this.#degraded(operation, args, new Error('circuit open'));
    }

    const redis = this.#getRedisStore();
    if (!redis) return this.#degraded(operation, args, new Error('store unavailable'));

    try {
      const result = await redis[operation](...args);
      if (this.#reported) {
        this.#reported = false;
        logger.info('ratelimit.redis_recovered', { prefix: this.#prefix });
      }
      return result;
    } catch (error) {
      this.#tripCircuit(error);
      return this.#degraded(operation, args, error);
    }
  }

  increment(key) {
    return this.#withFallback('increment', key);
  }

  decrement(key) {
    return this.#withFallback('decrement', key);
  }

  resetKey(key) {
    return this.#withFallback('resetKey', key);
  }

  async shutdown() {
    await this.#redis?.shutdown?.();
    await this.#memory.shutdown?.();
  }
}
