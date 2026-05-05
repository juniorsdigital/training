'use strict';

const { authenticateRequest } = require('./lib/apiAuth.js');
const { parseBody, upsertPlanDay } = require('./lib/trainingPlanService.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const planId = (req.query.planId || '').toString().trim();
    if (!planId) return res.status(400).json({ error: 'planId query param required.' });
    const body = parseBody(req);
    const day = await upsertPlanDay(planId, body);
    return res.status(200).json({ ok: true, day });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
