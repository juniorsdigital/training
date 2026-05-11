'use strict';

const { assertAllowedEmail, verifySupabaseUser } = require('../lib/supabaseAuth.js');
const { buildDashboardOverviewPayload } = require('../lib/dashboardOverviewData.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const localDate = (req.query.localDate || '').toString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return res.status(400).json({ error: 'Query localDate=YYYY-MM-DD is required.' });
    }

    if (accessToken) {
      const user = await verifySupabaseUser(accessToken);
      try {
        assertAllowedEmail(user);
      } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message });
      }
    }

    const includeHistory =
      req.query.includeHistory === '1' ||
      req.query.includeHistory === 'true' ||
      req.query.includeHistory === 'yes';
    const historyDaysRaw = Number(req.query.historyDays);
    const historyDays = Number.isFinite(historyDaysRaw) && historyDaysRaw > 0 ? historyDaysRaw : undefined;

    const payload = await buildDashboardOverviewPayload(localDate, {
      includeHistory,
      historyDays
    });
    if (!accessToken) {
      const safeBodyBattery = payload.bodyBattery
        ? {
            dailyEnergy: {
              score: payload.bodyBattery.dailyEnergy?.score ?? null,
              status: payload.bodyBattery.dailyEnergy?.status ?? null,
              confidence: payload.bodyBattery.dailyEnergy?.confidence ?? null,
              topPositive: payload.bodyBattery.dailyEnergy?.topPositive ?? [],
              topNegative: payload.bodyBattery.dailyEnergy?.topNegative ?? []
            },
            fitnessTrend: payload.bodyBattery.fitnessTrend || null
          }
        : null;
      return res.status(200).json({
        ok: true,
        localDate: payload.localDate,
        vitals: payload.vitals,
        eventsToday: payload.eventsToday,
        activitiesToday: payload.activitiesToday,
        primaryActivity: payload.primaryActivity,
        bodyBattery: safeBodyBattery,
        fetchErrors: payload.fetchErrors
      });
    }
    return res.status(200).json({ ok: true, ...payload });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
