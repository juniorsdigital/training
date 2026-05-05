'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const { parseBody, upsertPlan, upsertPlanDay } = require('../lib/trainingPlanService.js');

function addDays(startDate, offset) {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = parseBody(req);
    const weeks = Array.isArray(body.weeks) ? body.weeks : [];
    if (!weeks.length) {
      return res.status(400).json({ error: 'weeks[] is required for legacy seed.' });
    }
    const plan = await upsertPlan({
      name: body.name || 'Legacy Imported Training Plan',
      start_date: body.start_date || '2026-05-04',
      status: 'active',
      version: 1,
      total_weeks: weeks.length,
      source: 'legacy_seed'
    });
    let inserted = 0;
    for (let w = 0; w < weeks.length; w += 1) {
      const week = weeks[w];
      for (let d = 0; d < 7; d += 1) {
        const day = week.days?.[d] || {};
        await upsertPlanDay(plan.id, {
          week_index: w,
          day_index: d,
          day_date: addDays(body.start_date || '2026-05-04', w * 7 + d),
          session_type: day.t || 'rest',
          label: day.lbl || 'REST',
          details: day.det || '',
          target_watts_label: day.w || null,
          am_session: day.am || null,
          pm_session: day.pm || null,
          phase_label: week.phase || null,
          phase_code: week.pCode || null,
          goals: []
        });
        inserted += 1;
      }
    }
    return res.status(200).json({ ok: true, plan, insertedDays: inserted });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
