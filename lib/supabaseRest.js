'use strict';

function assertDbConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase database configuration.');
  }
}

function restUrl(path) {
  assertDbConfig();
  return `${process.env.SUPABASE_URL}/rest/v1${path}`;
}

function supabaseHeaders(extra = {}) {
  assertDbConfig();
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function requestJson(path, options = {}) {
  // #region agent log
  const _method = (options && options.method) || 'GET';
  const _hasApikey = !!(options && options.headers && (options.headers.apikey != null && String(options.headers.apikey).length > 0));
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '58d83e' }, body: JSON.stringify({ sessionId: '58d83e', location: 'lib/supabaseRest.js:requestJson', message: 'requestJson before fetch', data: { path, method: _method, hasApikeyHeader: _hasApikey, hypothesisId: 'H1' }, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  const response = await fetch(restUrl(path), options);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }
  return payload;
}

module.exports = { restUrl, supabaseHeaders, requestJson };
