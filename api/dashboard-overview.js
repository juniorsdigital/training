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
    if (!accessToken) {
      return res.status(401).json({ error: 'Missing auth token.' });
    }

    const user = await verifySupabaseUser(accessToken);
    try {
      assertAllowedEmail(user);
    } catch (err) {
      return res.status(err.statusCode || 403).json({ error: err.message });
    }

    const localDate = (req.query.localDate || '').toString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return res.status(400).json({ error: 'Query localDate=YYYY-MM-DD is required.' });
    }

    const payload = await buildDashboardOverviewPayload(localDate);
    return res.status(200).json({ ok: true, ...payload });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
