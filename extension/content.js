// Content Script : localisation ciblée et sûre de l'interface Web bancaire (§5.1 A).
// Ne modifie JAMAIS les champs saisis, mots de passe, montants ou données contenant des chiffres.
(() => {
  const originals = new WeakMap();
  const SAFE_SELECTOR = 'h1, h2, h3, h4, button, label, th, nav a, [data-nkap-translate]';
  const IGNORE_SELECTOR = 'input, textarea, select, code, pre, [type="password"], [data-nkap-ignore], .amount, .ca, .ctw-panel';

  function isSafeElement(el) {
    if (!el || el.closest(IGNORE_SELECTOR)) return false;
    // Ne toucher qu'aux éléments feuilles (pas de sous-éléments complexes)
    if (el.children.length > 0) return false;
    const text = (originals.get(el) ?? el.textContent ?? '').trim();
    if (!text || text.length > 120) return false;
    // Préservation stricte des données chiffrées (montants, comptes, dates, références)
    if (/\d/.test(text) || /\b(FCFA|XAF|EUR|USD)\b/i.test(text)) return false;
    return true;
  }

  function collectTargets() {
    const out = [];
    document.querySelectorAll(SAFE_SELECTOR).forEach((el) => {
      if (isSafeElement(el)) {
        if (!originals.has(el)) originals.set(el, el.textContent.trim());
        out.push(el);
      }
    });
    return out;
  }

  function restorePage() {
    let restored = 0;
    document.querySelectorAll('[data-nkap-localized="1"]').forEach((el) => {
      const orig = originals.get(el);
      if (orig !== undefined) {
        el.textContent = orig;
        el.removeAttribute('data-nkap-localized');
        restored++;
      }
    });
    return restored;
  }

  async function localizePage(lang, allowDraft) {
    const targets = collectTargets();
    if (!targets.length) return { count: 0, translated: 0 };

    const uniqueTexts = [...new Set(targets.map((el) => originals.get(el)))];
    const map = new Map();

    // 1. Vérifier d'abord le catalogue UI institutionnel (/v1/ui-resources)
    try {
      const uiRes = await chrome.runtime.sendMessage({
        type: 'NKAP_API',
        path: `/v1/ui-resources?lang=${encodeURIComponent(lang)}&channel=web`,
        method: 'GET',
      });
      if (uiRes?.ok && uiRes.data?.resources) {
        const resMap = uiRes.data.resources;
        for (const t of uniqueTexts) {
          const hit = Object.values(resMap).find((r) => r.value && t.toLowerCase() === String(r.value).toLowerCase());
          if (hit) map.set(t, hit.value);
        }
      }
    } catch {}

    // 2. Traduire les libellés restants par lots de 20 via POST /v1/translate
    const missing = uniqueTexts.filter((t) => !map.has(t));
    for (let i = 0; i < missing.length; i += 20) {
      const batch = missing.slice(i, i + 20);
      const r = await chrome.runtime.sendMessage({
        type: 'NKAP_API',
        path: '/v1/translate',
        method: 'POST',
        body: { texts: batch, from: 'fr', to: lang, allowDraft: !!allowDraft },
      });
      if (r?.ok && Array.isArray(r.data?.items)) {
        r.data.items.forEach((item, idx) => {
          if (item.accepted && item.text) map.set(batch[idx], item.text);
        });
      }
    }

    let translated = 0;
    for (const el of targets) {
      const orig = originals.get(el);
      const tr = map.get(orig);
      if (tr && tr !== el.textContent) {
        el.textContent = tr;
        el.setAttribute('data-nkap-localized', '1');
        translated++;
      }
    }
    return { count: targets.length, translated };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'NKAP_LOCALIZE_PAGE') {
      localizePage(msg.lang, msg.allowDraft)
        .then((res) => sendResponse({ ok: true, ...res }))
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    }
    if (msg.type === 'NKAP_RESTORE_PAGE') {
      sendResponse({ ok: true, restored: restorePage() });
      return false;
    }
  });
})();

