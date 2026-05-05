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
