import { config } from './config/index.js';
import { closePool } from './db/pool.js';
import { createApp } from './http/app.js';
import { logger } from './logger.js';
import { closeQueues } from './queue/index.js';

/**
 * API entrypoint.
 *
 * Deliberately thin: everything testable lives in createApp(), which tests
 * mount directly without binding a port.
 */

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server.started', {
    port: config.port,
    env: config.nodeEnv,
    dryRun: config.smsDryRun,
  });
});

// Keep-alive must outlive the load balancer's idle timeout, or the balancer
// reuses a socket the server is closing and surfaces spurious 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 60_000;

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown_started', { signal });

  // Hard deadline, so one stuck connection cannot block a deploy forever.
  const force = setTimeout(() => {
    logger.error('server.shutdown_timeout');
    process.exit(1);
  }, 20_000);
  force.unref();

  server.close(async (error) => {
    if (error) logger.error('server.close_failed', { message: error.message });

    // Dependencies are drained only once the listener has stopped accepting.
    await Promise.allSettled([closeQueues(), closePool()]);
    logger.info('server.shutdown_complete');
    process.exit(error ? 1 : exitCode);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log before dying. An unlogged exit is undebuggable in production.
process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', { name: error.name, message: error.message });
  shutdown('uncaughtException', 1);
});

export { app, server };
