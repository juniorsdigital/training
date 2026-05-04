'use strict';

// #region agent log
const DEBUG_INGEST = 'http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75';

function agentDebugLog(entry) {
  const payload = Object.assign(
    {
      sessionId: '21811c',
      timestamp: Date.now()
    },
    entry
  );
  fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '21811c'
    },
    body: JSON.stringify(payload)
  }).catch(() => {});
  console.log('[agent-debug-21811c]', JSON.stringify(payload));
}

module.exports = { agentDebugLog };
// #endregion
