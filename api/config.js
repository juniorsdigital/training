module.exports = async function handler(req, res) {
  // #region agent log
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'379764'},body:JSON.stringify({sessionId:'379764',runId:'pre-fix',hypothesisId:'H2',location:'api/config.js:1',message:'Config endpoint invoked',data:{method:req.method,url:req.url},timestamp:Date.now()})}).catch(()=>{});
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
