'use strict';

// TEMPORARY DEBUG ENDPOINT (debug session 230f27)
// Purpose: capture what req.body looks like when a text/csv POST hits a Vercel
// serverless function in this project's runtime. No auth, no DB writes.
// Delete this file once the CSV import bug is fixed.

const FORM_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>CSV body diagnostic (debug 230f27)</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#222}
h1{font-size:18px;margin:0 0 8px}
p{font-size:13px;color:#555}
fieldset{border:1px solid #ccc;padding:12px;border-radius:6px}
button{padding:8px 14px;font-size:14px;cursor:pointer}
pre{background:#0e0e10;color:#e6e6e6;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-word;font-size:12px;margin-top:16px}
.row{display:flex;gap:8px;align-items:center;margin:8px 0}
</style></head>
<body>
<h1>CSV body diagnostic</h1>
<p>Pick the same CSV file you've been trying to import. This page will POST the file as <code>text/csv</code> to <code>/api/debug-csv-body</code> and show you the JSON diagnostic. No auth required. Copy the resulting JSON and paste it back into the chat.</p>
<fieldset>
  <div class="row"><input id="f" type="file" accept=".csv,text/csv,*/*"></div>
  <div class="row"><button id="go">Send to debug endpoint</button></div>
</fieldset>
<pre id="out">(no result yet)</pre>
<script>
document.getElementById('go').addEventListener('click', async () => {
  const out = document.getElementById('out');
  const file = document.getElementById('f').files[0];
  if (!file) { out.textContent = 'Please pick a file first.'; return; }
  out.textContent = 'Sending ' + file.name + ' (' + file.size + ' bytes)...';
  try {
    const text = await file.text();
    const res = await fetch('/api/debug-csv-body', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: text
    });
    const json = await res.json().catch(() => ({}));
    out.textContent = 'fileName=' + file.name + '\\nfileSize=' + file.size + '\\nfrontendTextLen=' + text.length + '\\n\\nresponse:\\n' + JSON.stringify(json, null, 2);
  } catch (e) {
    out.textContent = 'Error: ' + (e && e.message ? e.message : String(e));
  }
});
</script>
</body></html>`;

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(FORM_HTML);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body;
  const bodyType = typeof body;
  const isBuffer = !!(body && bodyType === 'object' && typeof body.byteLength === 'number' && typeof body.copy === 'function');
  const isObject = body && bodyType === 'object' && !isBuffer;

  let bodyLen = 0;
  let preview = '';
  let trailingHex = '';
  if (bodyType === 'string') {
    bodyLen = body.length;
    preview = body.slice(0, 200);
    trailingHex = Buffer.from(body.slice(-16), 'utf8').toString('hex');
  } else if (isBuffer) {
    bodyLen = body.byteLength;
    try { preview = body.toString('utf8', 0, Math.min(200, body.byteLength)); } catch (_e) { preview = '<buffer-toString-failed>'; }
    try { trailingHex = body.slice(Math.max(0, body.byteLength - 16)).toString('hex'); } catch (_e) {}
  } else if (isObject) {
    try { const s = JSON.stringify(body); bodyLen = s.length; preview = s.slice(0, 200); } catch (_e) { preview = '<json-stringify-failed>'; }
  } else {
    preview = String(body);
  }

  const diag = {
    method: req.method,
    contentType: String(req.headers['content-type'] || ''),
    contentLength: req.headers['content-length'] || null,
    bodyType,
    isBuffer,
    isObject,
    bodyLen,
    preview,
    trailingHex,
    headerKeys: Object.keys(req.headers || {}),
    runtime: process.version,
    vercelEnv: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
  };

  // #region agent log
  try {
    fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '230f27' },
      body: JSON.stringify({
        sessionId: '230f27',
        hypothesisId: 'A,B,C',
        location: 'api/debug-csv-body.js',
        message: 'diagnostic endpoint received body',
        data: diag,
        timestamp: Date.now()
      })
    }).catch(() => {});
  } catch (_e) {}
  // #endregion

  return res.status(200).json({ ok: true, diag });
};
