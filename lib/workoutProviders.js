'use strict';

const { intervalsAuthorizationValue } = require('./intervalsBasicAuth.js');

const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1';

function formatYyyyMmDdUtc(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchIntervalsActivities(intervalsApiKey) {
  const athleteId = process.env.INTERVALS_ATHLETE_ID || '0';
  const newest = formatYyyyMmDdUtc(new Date());
  const oldestDate = new Date();
  oldestDate.setUTCDate(oldestDate.getUTCDate() - 365);
  const oldest = formatYyyyMmDdUtc(oldestDate);
  const activitiesUrl = `${INTERVALS_BASE_URL}/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}&limit=500`;
  const response = await fetch(activitiesUrl, {
    headers: {
      Authorization: intervalsAuthorizationValue(intervalsApiKey)
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Intervals.icu API error: ${text || response.status}`);
  }
  return response.json();
}

async function fetchGarminActivities() {
  const baseUrl = process.env.GARMIN_CONNECT_BASE_URL;
  const bearer = process.env.GARMIN_API_TOKEN;
  const athleteId = process.env.GARMIN_ATHLETE_ID || '';
  if (!baseUrl || !bearer) {
    throw new Error('Garmin Connect API is not configured.');
  }
  const newest = formatYyyyMmDdUtc(new Date());
  const oldestDate = new Date();
  oldestDate.setUTCDate(oldestDate.getUTCDate() - 365);
  const oldest = formatYyyyMmDdUtc(oldestDate);
  const queryAthlete = athleteId ? `&athleteId=${encodeURIComponent(athleteId)}` : '';
  const url = `${baseUrl.replace(/\/$/, '')}/activities?oldest=${oldest}&newest=${newest}${queryAthlete}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Garmin API error: ${text || response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Garmin API did not return an activity array.');
  }
  return data.map((a) => ({
    ...a,
    average_power: a.average_power ?? a.avg_power ?? null,
    normalized_power: a.normalized_power ?? a.weighted_avg_power ?? null,
    max_power: a.max_power ?? a.peak_power ?? null
  }));
}

async function fetchCompletedActivities() {
  const providerErrors = {};
  try {
    const garminActivities = await fetchGarminActivities();
    return { source: 'garmin', activities: garminActivities, providerErrors };
  } catch (err) {
    providerErrors.garmin = err.message || 'Garmin fetch failed.';
  }

  const intervalsApiKey = process.env.INTERVALS_API_KEY;
  if (!intervalsApiKey) {
    throw new Error(`Missing Intervals API key. Garmin error: ${providerErrors.garmin || 'n/a'}`);
  }
  const intervalsActivities = await fetchIntervalsActivities(intervalsApiKey);
  return { source: 'intervals', activities: intervalsActivities, providerErrors };
}

module.exports = { fetchCompletedActivities };
