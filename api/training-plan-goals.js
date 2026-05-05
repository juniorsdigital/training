'use strict';

const { authenticateRequest } = require('./lib/apiAuth.js');
const { parseBody, replaceDayGoals } = require('./lib/trainingPlanService.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const planDayId = (req.query.planDayId || '').toString().trim();
    if (!planDayId) return res.status(400).json({ error: 'planDayId query param required.' });
    const body = parseBody(req);
    const goals = await replaceDayGoals(planDayId, body.goals || []);
    return res.status(200).json({ ok: true, goals });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
