'use strict';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini is not configured. Set GEMINI_API_KEY.');
  return key;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI response was empty.');
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const slice = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  return JSON.parse(slice);
}

function toCompactPlan(plan) {
  return {
    id: plan?.id || null,
    name: plan?.name || null,
    version: plan?.version || null,
    start_date: plan?.start_date || null,
    days: (Array.isArray(plan?.days) ? plan.days : []).map((day) => ({
      id: day.id,
      week_index: day.week_index,
      day_index: day.day_index,
      day_date: day.day_date,
      session_type: day.session_type,
      label: day.label,
      details: day.details,
      target_watts_label: day.target_watts_label,
      am_session: day.am_session,
      pm_session: day.pm_session
    }))
  };
}

async function requestGeminiJson({ message, conversation, plan }) {
  const apiKey = getApiKey();
  const model = DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const prompt = [
    'You are an assistant that proposes updates to an athlete training plan.',
    'Only produce valid JSON with this exact top-level shape:',
    '{ "assistant_message": string, "operations": array }',
    'Allowed operation types only:',
    '- move_day_session: { "type":"move_day_session", "from": {"day_id": string} or {"week_index": number, "day_index": number}, "to": {...}, "reason": string? }',
    '- swap_day_sessions: { "type":"swap_day_sessions", "day_a": selector, "day_b": selector, "reason": string? }',
    '- update_day_notes: { "type":"update_day_notes", "target": selector, "notes": string, "mode": "replace"|"append", "reason": string? }',
    'Disallowed: creating/deleting weeks/days, changing plan metadata, changing goal schema, nutrition or recovery edits.',
    'If request cannot be satisfied safely, return operations as empty array and explain in assistant_message.',
    '',
    `User request: ${message}`,
    `Conversation context (most recent first, optional): ${JSON.stringify(Array.isArray(conversation) ? conversation.slice(-8) : [])}`,
    `Canonical plan snapshot: ${JSON.stringify(toCompactPlan(plan))}`
  ].join('\n');

  try {
    const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || 'Gemini request failed.';
      throw new Error(detail);
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
    const parsed = extractJsonObject(text);
    return {
      assistant_message: String(parsed?.assistant_message || '').trim(),
      operations: Array.isArray(parsed?.operations) ? parsed.operations : []
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Gemini request timed out. Please try again.');
    }
    throw new Error(`Gemini unavailable: ${error.message || 'request failed'}`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  requestGeminiJson
};
