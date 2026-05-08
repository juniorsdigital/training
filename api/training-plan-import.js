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

  // #region agent diag (debug session 230f27) - body inspection helper
  function _csvDiag() {
    const _b = req.body;
    const _t = typeof _b;
    const _isBuffer = !!(_b && _t === 'object' && typeof _b.byteLength === 'number' && typeof _b.copy === 'function');
    const _isObj = !!(_b && _t === 'object' && !_isBuffer);
    let _len = 0;
    let _preview = '';
    if (_t === 'string') { _len = _b.length; _preview = _b.slice(0, 120); }
    else if (_isBuffer) { _len = _b.byteLength; try { _preview = _b.toString('utf8', 0, Math.min(120, _b.byteLength)); } catch (_e) {} }
    else if (_isObj) { try { const _s = JSON.stringify(_b); _len = _s.length; _preview = _s.slice(0, 120); } catch (_e) {} }
    else { _preview = String(_b); }
    return { ct: String(req.headers['content-type'] || ''), cl: req.headers['content-length'] || null, type: _t, isBuffer: _isBuffer, isObject: _isObj, len: _len, preview: _preview };
  }
  // #endregion
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
    // #region agent diag (debug session 230f27) - surface diagnostic in response body
    let _diagStr = '';
    try { _diagStr = ' [diag230f27 ' + JSON.stringify(_csvDiag()) + ']'; } catch (_e) {}
    return res.status(500).json({ error: (error.message || 'Unexpected server error.') + _diagStr });
    // #endregion
  }
};
