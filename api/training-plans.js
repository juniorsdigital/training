'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const {
  parseBody,
  listPlans,
  getPlanById,
  upsertPlan,
  buildExportDocument,
  mapPlanToLegacyWeeks
} = require('../lib/trainingPlanService.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').toString().trim();
      const mode = (req.query.mode || '').toString().trim();
      if (!id) {
        const plans = await listPlans();
        return res.status(200).json({ ok: true, plans });
      }
      const plan = await getPlanById(id);
      if (!plan) return res.status(404).json({ error: 'Plan not found.' });
      if (mode === 'export') {
        const body = buildExportDocument(plan);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="training-plan-${id}.json"`);
        return res.status(200).send(JSON.stringify(body, null, 2));
      }
      if (mode === 'legacy-weeks') {
        return res.status(200).json({ ok: true, weeks: mapPlanToLegacyWeeks(plan), plan });
      }
      return res.status(200).json({ ok: true, plan });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const plan = await upsertPlan({
        id: body.id,
        name: body.name,
        start_date: body.start_date,
        status: body.status || 'draft',
        version: body.version,
        total_weeks: body.total_weeks,
        source: body.source || 'manual'
      });
      return res.status(200).json({ ok: true, plan });
    }

    if (req.method === 'PUT') {
      const id = (req.query.id || '').toString().trim();
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const body = parseBody(req);
      const plan = await upsertPlan({
        id,
        name: body.name,
        start_date: body.start_date,
        status: body.status || 'draft',
        version: body.version,
        total_weeks: body.total_weeks,
        source: body.source || 'manual'
      });
      return res.status(200).json({ ok: true, plan });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
