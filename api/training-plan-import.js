'use strict';

const { authenticateRequest } = require('../lib/apiAuth.js');
const { parseBody, overwriteCanonicalPlan } = require('../lib/trainingPlanService.js');
const { parsePlanCsv } = require('../lib/trainingPlanCsv.js');

module.exports = async function handler(req, res) {
  const user = await authenticateRequest(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    // #region agent log
    try {
      const _b = req.body;
      const _t = typeof _b;
      const _isBuffer = _b && typeof _b === 'object' && typeof _b.byteLength === 'number';
      const _len = _t === 'string' ? _b.length : (_isBuffer ? _b.byteLength : (_b ? Object.keys(_b).length : 0));
      const _preview = _t === 'string' ? _b.slice(0, 200) : (_isBuffer ? _b.toString('utf8', 0, Math.min(200, _b.byteLength)) : JSON.stringify(_b || null).slice(0, 200));
      fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'230f27'},body:JSON.stringify({sessionId:'230f27',hypothesisId:'A,B,C,D',location:'api/training-plan-import.js:17',message:'incoming request body diagnostic',data:{contentType,bodyType:_t,isBuffer:_isBuffer,bodyLen:_len,preview:_preview,headerKeys:Object.keys(req.headers||{})},timestamp:Date.now()})}).catch(()=>{});
    } catch (_e) {}
    // #endregion
    const incoming = contentType.includes('text/csv')
      ? parsePlanCsv(typeof req.body === 'string' ? req.body : '')
      : (() => {
        const body = parseBody(req);
        return body.plan || body;
      })();
    if (!incoming.name || !incoming.start_date) {
      return res.status(400).json({ error: 'plan.name and plan.start_date are required.' });
    }
    const plan = await overwriteCanonicalPlan(incoming);
    return res.status(200).json({
      ok: true,
      plan,
      importedDays: Array.isArray(plan?.days) ? plan.days.length : 0,
      mode: 'overwrite-canonical'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
