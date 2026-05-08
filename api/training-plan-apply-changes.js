'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const { parseBody, getCanonicalPlan, getPlanById, upsertPlanDay } = require('../lib/trainingPlanService.js');
const {
  normalizeOperations,
  applyOperationsToPlan,
  collectImpactedDayIds,
  createProposalHash,
  summarizeOperations
} = require('../lib/trainingPlanAiOps.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = parseBody(req);
    const providedOperations = Array.isArray(body?.operations) ? body.operations : [];
    const providedHash = String(body?.proposal_hash || '').trim();
    if (!providedOperations.length) return res.status(400).json({ error: 'operations are required.' });
    if (!providedHash) return res.status(400).json({ error: 'proposal_hash is required.' });

    const currentPlan = await getCanonicalPlan();
    if (!currentPlan) return res.status(404).json({ error: 'No canonical plan found.' });

    if (body?.plan_id && String(body.plan_id) !== String(currentPlan.id)) {
      return res.status(409).json({ error: 'Canonical plan changed. Refresh proposal and try again.' });
    }
    if (body?.plan_version && Number(body.plan_version) !== Number(currentPlan.version || 0)) {
      return res.status(409).json({ error: 'Plan version changed since preview. Refresh proposal and try again.' });
    }

    const normalizedOperations = normalizeOperations(currentPlan, providedOperations);
    const currentHash = createProposalHash(currentPlan, normalizedOperations);
    if (currentHash !== providedHash) {
      return res.status(409).json({ error: 'Proposal no longer matches the current plan. Refresh and retry.' });
    }

    const updatedPlanDraft = applyOperationsToPlan(currentPlan, normalizedOperations);
    const impactedIds = collectImpactedDayIds(normalizedOperations);
    for (const dayId of impactedIds) {
      const day = (updatedPlanDraft.days || []).find((entry) => String(entry.id) === String(dayId));
      if (!day) throw new Error(`Impacted day ${dayId} not found during apply.`);
      await upsertPlanDay(currentPlan.id, day);
    }

    const persisted = await getPlanById(currentPlan.id);
    return res.status(200).json({
      ok: true,
      plan: persisted,
      applied_operations: normalizedOperations.length,
      operation_summary: summarizeOperations(normalizedOperations),
      affected_day_ids: impactedIds
    });
  } catch (error) {
    const message = error.message || 'Unexpected server error.';
    const status = /required|must be|Unsupported operation|not found/.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
};
