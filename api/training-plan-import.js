'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const { parseBody, overwriteCanonicalPlan } = require('../lib/trainingPlanService.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = parseBody(req);
    const incoming = body.plan || body;
    if (!incoming.name || !incoming.start_date) {
      return res.status(400).json({ error: 'plan.name and plan.start_date are required.' });
    }
    const plan = await overwriteCanonicalPlan(incoming);
    return res.status(200).json({
      ok: true,
      plan,
      importedDays: Array.isArray(plan?.days) ? plan.days.length : 0,
      mode: 'overwrite-canonical'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
