'use strict';

/**
 * Intervals.icu personal API auth: Basic with username "API_KEY" and password = your key.
 * @see https://forum.intervals.icu/t/solved-api-use-401-unauthorized/112938
 */
function intervalsAuthorizationValue(apiKey) {
  const token = Buffer.from(`API_KEY:${apiKey}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

module.exports = { intervalsAuthorizationValue };
