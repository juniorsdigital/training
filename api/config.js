const { agentDebugLog } = require('./lib/agentDebugLog.js');

module.exports = async function handler(req, res) {
  // #region agent log
  agentDebugLog({
    hypothesisId: 'H2',
    location: 'api/config.js:entry',
    message: 'config handler invoked',
    data: { method: req.method, url: String(req.url || ''), vercelEnv: process.env.VERCEL_ENV || null }
  });
  // #endregion

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const allowedEmail = process.env.ALLOWED_LOGIN_EMAIL || '';

  if (!supabaseUrl || !supabaseAnonKey || !allowedEmail) {
    return res.status(500).json({ error: 'Missing required environment variables.' });
  }

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    allowedEmail
  });
}
