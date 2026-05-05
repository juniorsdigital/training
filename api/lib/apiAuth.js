'use strict';

const { assertAllowedEmail, verifySupabaseUser } = require('./supabaseAuth.js');

async function authenticateRequest(req, res) {
  // #region agent log
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'379764'},body:JSON.stringify({sessionId:'379764',runId:'pre-fix',hypothesisId:'H4',location:'api/lib/apiAuth.js:6',message:'authenticateRequest called',data:{hasAuthHeader:Boolean(req.headers.authorization)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) {
    res.status(401).json({ error: 'Missing auth token.' });
    return null;
  }

  let user;
  try {
    user = await verifySupabaseUser(accessToken);
  } catch {
    res.status(401).json({ error: 'Invalid session.' });
    return null;
  }

  try {
    assertAllowedEmail(user);
  } catch (err) {
    res.status(err.statusCode || 403).json({ error: err.message });
    return null;
  }

  return user;
}

module.exports = { authenticateRequest };
