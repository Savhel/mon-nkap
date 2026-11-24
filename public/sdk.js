// SDK navigateur Mon Nkap : une page web ou l'extension Mboa appelle le moteur commun.
//   <script src="https://<serveur>/sdk.js"></script>
//   const ct = MonNkap.connect('https://<serveur>', { channel: 'web', lang: 'ewo' });
//   const r = await ct.message('envoie 5000 a Marie');   // r.reply.text, r.reply.menu, r.intent, r.params…
//   const v = await ct.voice(blobAudio);                 // { transcript, result }
//   await ct.confirm(r.canonical.confirmationToken);     // exécute l'opération présentée (jeton à usage unique)
// Aucune clé secrète : le SDK ne parle qu'à l'API du moteur.
(function (g) {
  function connect(base, opts) {
    opts = opts || {};
    var url = String(base || '').replace(/\/$/, '');
    var session = opts.sessionId || 'sdk-' + Math.random().toString(36).slice(2, 10);
    var channel = opts.channel || 'web';
    var lang = opts.lang || 'fr';
    async function call(path, init) {
      var res = await fetch(url + path, init);
      var data = await res.json();
      if (!res.ok || data.error) throw new Error(data.message || data.error || ('HTTP ' + res.status));
      return data;
    }
    return {
      get sessionId() { return session; },
      setLang: function (l) { lang = l; },
      message: async function (text) {
        var r = await call('/v1/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session, channel: channel, lang: lang, text: text, userPhone: opts.userPhone }) });
        lang = r.lang; // le moteur peut changer de langue en cours de conversation
        return r;
      },
      voice: async function (blob) {
        var q = new URLSearchParams({ sessionId: session, channel: channel, lang: lang });
        var r = await call('/v1/voice?' + q, { method: 'POST', body: blob });
        if (r.result) lang = r.result.lang;
        return r;
      },
      /** Confirme l'opération présentée, avec le jeton reçu (result.canonical.confirmationToken). */
      confirm: async function (token) {
        return call('/v1/confirm', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'confirm-' + token }, body: JSON.stringify({ sessionId: session, token: token, channel: channel, userPhone: opts.userPhone }) });
      },
      /** Analyse sans dialogue ni exécution : représentation canonique d'une phrase. */
      analyze: async function (text) {
        return call('/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text, lang: lang, channel: channel }) });
      },
      languages: function () { return call('/v1/languages'); },
      reset: function () { session = 'sdk-' + Math.random().toString(36).slice(2, 10); },
    };
  }
  g.MonNkap = { connect: connect };
})(typeof window !== 'undefined' ? window : globalThis);
