/**
 * LINE Webhook — รับ messages และ events จาก LINE Messaging API
 */
import express from 'express';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { ok, asyncRoute } from '../utils/http.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /webhook/line — รับ webhook จาก LINE Messaging API
 */
router.post('/line', asyncRoute(async (req, res) => {
  const events = req.body?.events || [];

  if (!Array.isArray(events)) {
    logger.warn('webhook: invalid events format', { body: req.body });
    return ok(res, { ok: true });
  }

  // ประมวลผล events
  for (const event of events) {
    try {
      if (event.type === 'message') {
        logger.info('webhook: received message', {
          userId: event.source?.userId,
          messageType: event.message?.type,
          text: event.message?.text,
        });
      } else if (event.type === 'follow') {
        logger.info('webhook: user followed bot', {
          userId: event.source?.userId,
        });
      }
    } catch (err) {
      logger.error('webhook: error processing event', { error: String(err) });
    }
  }

  // ตอบ 200 OK ให้ LINE
  return ok(res, { ok: true });
}));

export default router;