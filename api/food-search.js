'use strict';

const { assertAllowedEmail, verifySupabaseUser } = require('../lib/supabaseAuth.js');

const FDC_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const NUTRIENT_KCAL = 1008;
const NUTRIENT_CARB = 1005;
const NUTRIENT_PROTEIN = 1003;
const NUTRIENT_FAT = 1004;

const cache = new Map();
const CACHE_TTL_MS = 30_000;

function nutrientAmount(foodNutrients, nutrientId) {
  const list = Array.isArray(foodNutrients) ? foodNutrients : [];
  for (const n of list) {
    const id = n?.nutrientId ?? n?.nutrient?.id;
    if (Number(id) === nutrientId) {
      const val = n?.value ?? n?.amount;
      const num = Number(val);
      return Number.isFinite(num) ? Math.round(num) : null;
    }
  }
  return null;
}

function normalizeFood(item) {
  return {
    fdcId: item?.fdcId ?? null,
    description: String(item?.description || '').trim(),
    calories: nutrientAmount(item?.foodNutrients, NUTRIENT_KCAL),
    carbs: nutrientAmount(item?.foodNutrients, NUTRIENT_CARB),
    protein: nutrientAmount(item?.foodNutrients, NUTRIENT_PROTEIN),
    fat: nutrientAmount(item?.foodNutrients, NUTRIENT_FAT),
    servingSize: item?.servingSize != null ? Number(item.servingSize) : null,
    servingUnit: item?.servingSizeUnit ? String(item.servingSizeUnit) : null
  };
}

async function authenticate(req, res) {
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
    res.status(403).json({ error: err.message });
    return null;
  }
  return user;
}

module.exports = async function handler(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const query = String(req.query.q || req.query.query || '').trim();
  if (query.length < 2) {
    return res.status(400).json({ error: 'Query param q (min 2 chars) is required.' });
  }

  const apiKey = String(process.env.USDA_FDC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Food search is not configured (USDA_FDC_API_KEY).' });
  }

  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.status(200).json({ ok: true, foods: cached.foods });
  }

  try {
    const url = new URL(FDC_SEARCH_URL);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('dataType', 'Foundation,SR Legacy,Survey (FNDDS),Branded');

    const upstream = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(502).json({
        error: 'USDA FoodData Central search failed.',
        detail: txt.slice(0, 200)
      });
    }

    const data = await upstream.json();
    const foods = (Array.isArray(data?.foods) ? data.foods : [])
      .map(normalizeFood)
      .filter((f) => f.description);

    cache.set(cacheKey, { at: Date.now(), foods });
    return res.status(200).json({ ok: true, foods });
  } catch (err) {
    return res.status(502).json({
      error: 'Food search temporarily unavailable.',
      detail: err.message || 'Unknown error'
    });
  }
};
