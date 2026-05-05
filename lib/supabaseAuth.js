'use strict';

// #region agent log
fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'379764'},body:JSON.stringify({sessionId:'379764',runId:'pre-fix',hypothesisId:'H1',location:'api/lib/supabaseAuth.js:3',message:'supabaseAuth module loaded',data:{nodeEnv:process.env.NODE_ENV||'unknown'},timestamp:Date.now()})}).catch(()=>{});
// #endregion

async function verifySupabaseUser(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase auth configuration.');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey
    }
  });

  if (!response.ok) {
    throw new Error('Invalid Supabase session.');
  }

  return response.json();
}

function assertAllowedEmail(user) {
  const allowedEmail = (process.env.ALLOWED_LOGIN_EMAIL || '').toLowerCase();
  if (!allowedEmail || (user.email || '').toLowerCase() !== allowedEmail) {
    const error = new Error('Unauthorized account.');
    error.statusCode = 403;
    throw error;
  }
}

module.exports = { verifySupabaseUser, assertAllowedEmail };
