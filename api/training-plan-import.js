'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const { parseBody, overwriteCanonicalPlan } = require('../lib/trainingPlanService.js');
const { parsePlanCsv } = require('../lib/trainingPlanCsv.js');

async function readRequestBodyAsString(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let incoming;
    if (contentType.includes('text/csv')) {
      const csvText = await readRequestBodyAsString(req);
      incoming = parsePlanCsv(csvText);
    } else {
      const body = parseBody(req);
      incoming = body.plan || body;
    }
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
