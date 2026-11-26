// Service Worker Manifest V3 : isole la clé API et relaie les appels vers le serveur Mon Nkap.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

const DEFAULTS = {
  serverUrl: 'http://localhost:8080',
  apiKey: '',
  lang: 'dua',
  allowDraft: true,
};

async function getConfig() {
  const saved = await chrome.storage.local.get(DEFAULTS);
  return {
    serverUrl: String(saved.serverUrl || DEFAULTS.serverUrl).replace(/\/$/, ''),
    apiKey: String(saved.apiKey || ''),
    lang: String(saved.lang || DEFAULTS.lang),
    allowDraft: Boolean(saved.allowDraft),
  };
}

async function apiCall(path, method = 'GET', body) {
  const cfg = await getConfig();
  const headers = { accept: 'application/json' };
  if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${cfg.serverUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'NKAP_GET_CONFIG') return sendResponse({ ok: true, config: await getConfig() });
    if (msg.type === 'NKAP_SET_CONFIG') {
      await chrome.storage.local.set(msg.config || {});
      return sendResponse({ ok: true, config: await getConfig() });
    }
    if (msg.type === 'NKAP_API') {
      const data = await apiCall(msg.path, msg.method, msg.body);
      return sendResponse({ ok: true, data });
    }
    return sendResponse({ ok: false, error: 'unknown_message' });
  })().catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

