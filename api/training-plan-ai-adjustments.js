'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const { parseBody, getCanonicalPlan } = require('../lib/trainingPlanService.js');
const { buildDashboardOverviewPayload } = require('../lib/dashboardOverviewData.js');
const { requestGeminiJson, buildAthleteContextForPrompt } = require('../lib/aiGemini.js');
const {
  normalizeOperations,
  buildPreview,
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
    const message = String(body?.message || '').trim();
    const localDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.localDate || ''))
      ? String(body.localDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    if (!message) return res.status(400).json({ error: 'message is required.' });

    const plan = await getCanonicalPlan();
    if (!plan) return res.status(404).json({ error: 'No canonical plan found.' });
    let athleteContext = buildAthleteContextForPrompt({
      localDate,
      recentDays: 21,
      plan
    });
    try {
      const overview = await buildDashboardOverviewPayload(localDate, { historyDays: 21, includeHistory: true });
      athleteContext = buildAthleteContextForPrompt({
        localDate,
        recentDays: 21,
        plan,
        overview
      });
    } catch (_) {
      // Fall back to plan-only context if athlete feeds are unavailable.
    }

    const aiProposal = await requestGeminiJson({
      message,
      conversation: body?.conversation || [],
      plan,
      athleteContext
    });
    const normalizedOperations = normalizeOperations(plan, aiProposal.operations || [], { allowEmpty: true });
    const preview = buildPreview(plan, normalizedOperations);
    const proposalHash = normalizedOperations.length ? createProposalHash(plan, normalizedOperations) : null;
    const operationSummary = summarizeOperations(normalizedOperations);

    return res.status(200).json({
      ok: true,
      assistant_message: aiProposal.assistant_message || 'I prepared an update proposal for your review.',
      operations: normalizedOperations,
      preview,
      proposal_hash: proposalHash,
      plan_id: plan.id,
      plan_version: Number(plan.version || 0),
      operation_summary: operationSummary,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    const message = error.message || 'Unexpected server error.';
    const status = /required|Unsupported operation|not found|must be|At least one operation/.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
};
