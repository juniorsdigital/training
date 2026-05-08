'use strict';

const { getCanonicalPlan } = require('../lib/trainingPlanService.js');
const { buildDashboardOverviewPayload } = require('../lib/dashboardOverviewData.js');
const { requestGeminiJson, buildAthleteContextForPrompt } = require('../lib/aiGemini.js');
const {
  normalizeOperations,
  buildPreview,
  createProposalHash,
  summarizeOperations
} = require('../lib/trainingPlanAiOps.js');

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isoDateMinusDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function compactUpcomingPlanDays(plan, startDate, limit = 5) {
  return (Array.isArray(plan?.days) ? plan.days : [])
    .filter((day) => String(day.day_date || '') >= startDate)
    .sort((a, b) => String(a.day_date || '').localeCompare(String(b.day_date || '')))
    .slice(0, limit)
    .map((day) => ({
      day_id: day.id,
      day_date: day.day_date,
      week_index: day.week_index,
      day_index: day.day_index,
      session_type: day.session_type,
      label: day.label,
      details: day.details,
      target_watts_label: day.target_watts_label
    }));
}

function verifyCronAuth(req, res) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret) return true;
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (bearer !== cronSecret) {
    res.status(401).json({ error: 'Unauthorized cron invocation.' });
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!verifyCronAuth(req, res)) return;

  try {
    const localDate = isIsoDate(req.query.localDate)
      ? String(req.query.localDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const yesterday = isoDateMinusDays(localDate, 1);

    const plan = await getCanonicalPlan();
    if (!plan) return res.status(404).json({ error: 'No canonical plan found.' });

    const upcomingPlanDays = compactUpcomingPlanDays(plan, localDate, 5);
    let athleteContext = buildAthleteContextForPrompt({
      localDate: yesterday,
      recentDays: 21,
      plan
    });
    let overviewDate = yesterday;
    try {
      const overview = await buildDashboardOverviewPayload(yesterday, { historyDays: 21, includeHistory: true });
      athleteContext = buildAthleteContextForPrompt({
        localDate: yesterday,
        recentDays: 21,
        plan,
        overview
      });
      overviewDate = overview.localDate || yesterday;
    } catch (_) {
      // Athlete feeds can be unavailable; proceed with plan-only fallback context.
    }

    const message = [
      `Daily automation run for ${localDate}.`,
      `Analyze yesterday (${yesterday}) workout readiness/outcome and compare to the canonical plan.`,
      'Recommend only high-value deviations for the upcoming workouts if warranted by fatigue/readiness/load context.',
      'If no deviations are needed, return no operations and explain why.',
      `Upcoming plan days: ${JSON.stringify(upcomingPlanDays)}`
    ].join(' ');

    const aiProposal = await requestGeminiJson({
      message,
      conversation: [],
      plan,
      athleteContext
    });
    const normalizedOperations = normalizeOperations(plan, aiProposal.operations || [], { allowEmpty: true });
    const preview = buildPreview(plan, normalizedOperations);
    const proposalHash = normalizedOperations.length ? createProposalHash(plan, normalizedOperations) : null;

    return res.status(200).json({
      ok: true,
      run_type: 'daily_recommendation',
      local_date: localDate,
      analyzed_date: overviewDate,
      upcoming_plan_days: upcomingPlanDays,
      assistant_message: aiProposal.assistant_message || 'Daily recommendation complete.',
      operations: normalizedOperations,
      preview,
      proposal_hash: proposalHash,
      plan_id: plan.id,
      plan_version: Number(plan.version || 0),
      operation_summary: summarizeOperations(normalizedOperations),
      created_at: new Date().toISOString()
    });
  } catch (error) {
    const message = error.message || 'Unexpected server error.';
    const status = /required|Unsupported operation|not found|must be|At least one operation/.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
};
