/** รัน schema migration แบบสแตนด์อโลน: npm run migrate */
import { initDatabase, db } from './index.js';
import { logger } from '../utils/logger.js';

await initDatabase();
const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
logger.info('migration complete', { driver: db.driver, tables: tables.map((t) => t.name) });
process.exit(0);
