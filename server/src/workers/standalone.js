/**
 * รัน worker แยกโปรเซส (สำหรับ deployment ที่แยก container: frontend / backend / worker)
 *   node src/workers/standalone.js
 */
import { initDatabase } from '../db/index.js';
import { startQueue, stopQueue, recoverStuckJobs } from './queue.js';
import { startCleanupWorker, stopCleanupWorker } from './cleanup.js';
import { logger } from '../utils/logger.js';

await initDatabase();
recoverStuckJobs();
startQueue({ intervalMs: 1500 });
startCleanupWorker();
logger.info('standalone worker running');

const shutdown = (signal) => {
  logger.info('worker shutting down', { signal });
  stopQueue();
  stopCleanupWorker();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
