'use strict';

const { assertAllowedEmail, verifySupabaseUser } = require('./supabaseAuth.js');

async function authenticateRequest(req, res) {
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
