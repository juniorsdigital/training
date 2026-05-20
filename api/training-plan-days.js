'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const {
  parseBody,
  upsertPlanDay,
  deletePlanDay,
  movePlanSession,
  swapPlanSessions,
} = require('../lib/trainingPlanService.js');
const { DEFAULT_FTP } = require('../lib/projectedTss.js');

function parseFtp(body) {
  const n = Number(body?.ftp);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FTP;
}

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    if (req.method === 'PUT') {
      const planId = (req.query.planId || '').toString().trim();
      if (!planId) return res.status(400).json({ error: 'planId query param required.' });
      const body = parseBody(req);
      const day = await upsertPlanDay(planId, body, {
        ftp: parseFtp(body),
        manualOverride: Boolean(body.tss_manual_override),
        enforceTss: true
      });
      return res.status(200).json({ ok: true, day });
    }

    if (req.method === 'DELETE') {
      const dayId = (req.query.dayId || '').toString().trim();
      if (!dayId) return res.status(400).json({ error: 'dayId query param required.' });
      const result = await deletePlanDay(dayId);
      return res.status(200).json({ ok: true, ...result });
    }

    if (req.method === 'POST') {
      const planId = (req.query.planId || '').toString().trim();
      if (!planId) return res.status(400).json({ error: 'planId query param required.' });
      const body = parseBody(req);
      const op = String(body.op || '').trim().toLowerCase();
      const ftp = parseFtp(body);

      if (op === 'move') {
        const fromDayId = String(body.from_day_id || '').trim();
        const toWeekIndex = Number(body.to_week_index);
        const toDayIndex = Number(body.to_day_index);
        if (!fromDayId) return res.status(400).json({ error: 'from_day_id is required.' });
        if (!Number.isInteger(toWeekIndex) || toWeekIndex < 0) {
          return res.status(400).json({ error: 'to_week_index is required.' });
        }
        if (!Number.isInteger(toDayIndex) || toDayIndex < 0 || toDayIndex > 6) {
          return res.status(400).json({ error: 'to_day_index must be 0..6.' });
        }
        const toDayDate = String(body.to_day_date || '').trim();
        const result = await movePlanSession(planId, fromDayId, toWeekIndex, toDayIndex, {
          ftp,
          toDayDate: toDayDate || undefined
        });
        return res.status(200).json({ ok: true, ...result });
      }

      if (op === 'swap') {
        const dayAId = String(body.day_a_id || '').trim();
        const dayBId = String(body.day_b_id || '').trim();
        if (!dayAId || !dayBId) {
          return res.status(400).json({ error: 'day_a_id and day_b_id are required.' });
        }
        const result = await swapPlanSessions(planId, dayAId, dayBId, { ftp });
        return res.status(200).json({ ok: true, ...result });
      }

      return res.status(400).json({ error: 'Unsupported op. Use move or swap.' });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    const message = error.message || 'Unexpected server error.';
    const status = /required|must be|not found|same day/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
};
