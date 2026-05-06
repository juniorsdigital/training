'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const {
  parseBody,
  listPlans,
  getPlanById,
  getCanonicalPlan,
  upsertPlan,
  buildExportDocument,
  mapPlanToLegacyWeeks
} = require('../lib/trainingPlanService.js');
const { serializePlanToCsv, templateCsvFromPlan } = require('../lib/trainingPlanCsv.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').toString().trim();
      const mode = (req.query.mode || '').toString().trim();
      if (mode === 'list') {
        const plans = await listPlans();
        return res.status(200).json({ ok: true, plans });
      }

      const selectedPlan = id ? await getPlanById(id) : await getCanonicalPlan();
      if (!selectedPlan) {
        if (mode === 'export') return res.status(404).json({ error: 'No canonical plan found.' });
        if (mode === 'template-csv') {
          const content = templateCsvFromPlan(null);
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', 'attachment; filename="training-plan-template.csv"');
          return res.status(200).send(content);
        }
        if (mode === 'legacy-weeks') return res.status(200).json({ ok: true, weeks: [], plan: null });
        return res.status(200).json({ ok: true, plan: null });
      }
      if (mode === 'export') {
        const format = (req.query.format || 'json').toString().trim().toLowerCase();
        if (format === 'csv') {
          const content = serializePlanToCsv(selectedPlan);
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="training-plan-${selectedPlan.id}.csv"`);
          return res.status(200).send(content);
        }
        const body = buildExportDocument(selectedPlan);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="training-plan-${selectedPlan.id}.json"`);
        return res.status(200).send(JSON.stringify(body, null, 2));
      }
      if (mode === 'template-csv') {
        const content = templateCsvFromPlan(selectedPlan);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="training-plan-template-${selectedPlan.id}.csv"`);
        return res.status(200).send(content);
      }
      if (mode === 'legacy-weeks') {
        return res.status(200).json({ ok: true, weeks: mapPlanToLegacyWeeks(selectedPlan), plan: selectedPlan });
      }
      return res.status(200).json({ ok: true, plan: selectedPlan });
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
