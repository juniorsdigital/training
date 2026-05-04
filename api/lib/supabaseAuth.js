'use strict';

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
