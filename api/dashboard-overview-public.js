'use strict';

const { buildDashboardOverviewPayload } = require('../lib/dashboardOverviewData.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const localDate = (req.query.localDate || '').toString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return res.status(400).json({ error: 'Query localDate=YYYY-MM-DD is required.' });
    }

    const payload = await buildDashboardOverviewPayload(localDate);
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
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
