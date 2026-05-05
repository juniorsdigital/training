'use strict';

const { authenticateRequest } = require('./lib/apiAuth.js');
const { parseBody, upsertPlan, upsertPlanDay } = require('./lib/trainingPlanService.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = parseBody(req);
    const incoming = body.plan || body;
    const incomingDays = Array.isArray(incoming.days) ? incoming.days : [];
    if (!incoming.name || !incoming.start_date) {
      return res.status(400).json({ error: 'plan.name and plan.start_date are required.' });
    }
    const baseVersion = Number(incoming.version) || 1;
    const importedPlan = await upsertPlan({
      name: body.new_name || `${incoming.name} (Imported)`,
      start_date: incoming.start_date,
      status: body.status || 'draft',
      version: baseVersion + 1,
      total_weeks: incoming.total_weeks,
      source: 'import'
    });

    const results = [];
    for (const day of incomingDays) {
      const saved = await upsertPlanDay(importedPlan.id, day);
      results.push(saved.id);
    }
    return res.status(200).json({ ok: true, plan: importedPlan, importedDays: results.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
