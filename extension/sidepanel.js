const $ = (id) => document.getElementById(id);
let sessionId = 'ext-' + Math.random().toString(36).slice(2, 10);
let cfg = { serverUrl: 'http://localhost:8080', apiKey: '', lang: 'dua', allowDraft: true };

function addBubble(who, text, meta, actions) {
  const b = document.createElement('div');
  b.className = `msg ${who}`;
  b.textContent = text;
  if (meta) {
    const s = document.createElement('span');
    s.className = 'meta';
    s.textContent = meta;
    b.append(s);
  }
  if (actions) b.append(actions);
  $('log').append(b);
  $('log').scrollTop = $('log').scrollHeight;
}

async function callApi(path, method = 'GET', body) {
  const res = await chrome.runtime.sendMessage({ type: 'NKAP_API', path, method, body });
  if (!res?.ok) throw new Error(res?.error || 'Erreur de communication');
  return res.data;
}

async function init() {
  const c = await chrome.runtime.sendMessage({ type: 'NKAP_GET_CONFIG' });
  if (c?.ok) cfg = c.config;
  try {
    const reg = await callApi('/v1/languages');
    $('lang').textContent = '';
    for (const l of (reg.languages || []).filter((x) => x.capabilities?.understanding?.status !== 'unavailable')) {
      const o = document.createElement('option');
      o.value = l.code;
      o.textContent = `${l.native || l.name} (${l.code})`;
      $('lang').append(o);
    }
    $('lang').value = cfg.lang || 'dua';
    $('status').textContent = `Connecté à ${cfg.serverUrl}`;
  } catch (err) {
    $('status').textContent = `Hors ligne (${err.message})`;
  }
}

$('lang').onchange = async () => {
  cfg.lang = $('lang').value;
  await chrome.runtime.sendMessage({ type: 'NKAP_SET_CONFIG', config: { lang: cfg.lang } });
};

$('loc-btn').onclick = async () => {
  $('status').textContent = 'Localisation de la page…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'NKAP_LOCALIZE_PAGE', lang: $('lang').value, allowDraft: cfg.allowDraft });
    $('status').textContent = res?.ok ? `${res.translated}/${res.count} libellé(s) adapté(s).` : (res?.error || 'Page non accessible');
  } catch (err) {
    $('status').textContent = err.message;
  }
};

$('rst-btn').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'NKAP_RESTORE_PAGE' });
    $('status').textContent = res?.ok ? `${res.restored} libellé(s) restauré(s).` : 'Erreur';
  } catch {}
};

function renderResult(r) {
  let actions = null;
  if (r.status === 'awaiting_confirmation' && r.canonical?.confirmationToken) {
    actions = document.createElement('div');
    actions.className = 'actions';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.textContent = 'Confirmer';
    yes.onclick = async () => {
      yes.disabled = true;
      const out = await callApi('/v1/confirm', 'POST', { sessionId, token: r.canonical.confirmationToken, channel: 'web' });
      renderResult(out);
    };
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'sec'; no.textContent = 'Annuler';
    no.onclick = () => sendText('non');
    actions.append(yes, no);
  }
  const meta = `${r.canonical?.operation || '—'} · ${r.reply?.quality || ''} ${r.reply?.fr && r.reply.fr !== r.reply.text ? `· FR: ${r.reply.fr}` : ''}`;
  addBubble('bot', r.reply?.text || '…', meta, actions);
}

async function sendText(text) {
  if (!text) return;
  addBubble('me', text);
  try {
    const r = await callApi('/v1/message', 'POST', { sessionId, channel: 'web', lang: $('lang').value, text });
    if (r.lang) $('lang').value = r.lang;
    renderResult(r);
  } catch (err) {
    addBubble('bot', `Erreur : ${err.message}`);
  }
}

$('form').onsubmit = (e) => {
  e.preventDefault();
  const t = $('input').value.trim();
  $('input').value = '';
  sendText(t);
};

init();

