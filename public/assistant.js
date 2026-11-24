// Composant « assistant financier dans votre langue », partagé par l'application mobile et le widget web.
// Il ne contient aucune intelligence : il affiche ce que renvoie le moteur commun (via sdk.js).
//   MonNkapAssistant.mount(element, { server: '', channel: 'mobile', lang: 'ewo' })
// Tout texte venant du serveur est inséré avec textContent (jamais interprété comme du HTML).
(function (g) {
  var QUALITY = {
    validated: ['Validé par des natifs', 'ok'],
    draft: ['Brouillon, non relu', 'warn'],
    machine: ['Traduction automatique', 'warn'],
    fallback: ['Réponse en français (phrase pas encore traduite)', 'muted'],
  };
  var QUICK = [['Solde', 'solde'], ['Envoyer', 'envoyer de l’argent'], ['Frais', 'frais'], ['Historique', 'historique'], ['Crédit', 'acheter du crédit'], ['Facture', 'payer une facture']];
  var SVG = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function micIcon() {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round');
    ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'].forEach(function (d) {
      var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p);
    });
    return s;
  }

  function mount(root, opts) {
    opts = opts || {};
    var ct = g.MonNkap.connect(opts.server || '', { channel: opts.channel || 'web', lang: opts.lang || 'fr' });
    root.classList.add('ca');
    var top = el('div', 'ca-top');
    var langSel = el('select', 'ca-lang'); langSel.setAttribute('aria-label', 'Langue');
    var info = el('button', 'ca-ghost', 'Détails techniques'); info.type = 'button'; info.setAttribute('aria-pressed', 'false');
    top.append(langSel, info);
    var log = el('div', 'ca-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
    var quick = el('div', 'ca-quick');
    QUICK.forEach(function (q) { var b = el('button', 'ca-chip', q[0]); b.type = 'button'; b.onclick = function () { send(q[1], q[0]); }; quick.append(b); });
    var form = el('form', 'ca-form');
    var input = el('input', 'ca-input'); input.placeholder = 'Écrivez ou parlez dans votre langue…'; input.setAttribute('aria-label', 'Votre demande');
    var mic = el('button', 'ca-mic'); mic.type = 'button'; mic.setAttribute('aria-label', 'Parler'); mic.append(micIcon());
    var go = el('button', 'ca-send', 'Envoyer'); go.type = 'submit';
    form.append(input, mic, go);
    root.append(top, log, quick, form);
    var showDetails = false;
    info.onclick = function () { showDetails = !showDetails; info.setAttribute('aria-pressed', String(showDetails)); root.classList.toggle('ca-details', showDetails); };

    ct.languages().then(function (reg) {
      (reg.languages || []).filter(function (l) { return l.capabilities && l.capabilities.understanding && l.capabilities.understanding.status !== 'unavailable'; })
        .forEach(function (l) { var o = el('option', null, l.native || l.name); o.value = l.code; langSel.append(o); });
      langSel.value = opts.lang || 'fr';
    }).catch(function () { var o = el('option', null, 'Français'); o.value = 'fr'; langSel.append(o); });
    langSel.onchange = function () { ct.setLang(langSel.value); };

    function bubble(who, text) { var b = el('div', 'ca-b ca-' + who, text); log.append(b); log.scrollTop = log.scrollHeight; return b; }

    function render(r) {
      langSel.value = r.lang;
      var b = bubble('bot', r.reply.text);
      var ref = r.lang === 'fr' || r.lang === 'en';
      var q = ref ? ['Langue de référence (' + (r.lang === 'fr' ? 'français' : 'anglais') + ')', 'muted'] : QUALITY[r.reply.quality] || QUALITY.fallback;
      b.append(el('span', 'ca-q ca-' + q[1], q[0]));
      if (r.reply.quality !== 'validated' && r.reply.fr && r.reply.fr !== r.reply.text) b.append(el('span', 'ca-fr', 'Français : ' + r.reply.fr));
      var c = r.canonical || {};
      b.append(el('pre', 'ca-canon', JSON.stringify({ operation: c.operation, act: c.act, entities: c.entities, status: c.status, confidence: c.confidence }, null, 1)));
      if (r.status === 'awaiting_confirmation' && c.confirmationToken) {
        var row = el('div', 'ca-actions');
        var yes = el('button', 'ca-yes', 'Confirmer'); yes.type = 'button';
        var no = el('button', 'ca-no', 'Annuler'); no.type = 'button';
        yes.onclick = function () { yes.disabled = no.disabled = true; ct.confirm(c.confirmationToken).then(render).catch(function (e) { bubble('err', 'Confirmation refusée : ' + e.message); }); };
        no.onclick = function () { yes.disabled = no.disabled = true; send('2', 'Annuler'); };
        row.append(yes, no); b.append(row);
      } else if (r.reply.menu && r.reply.menu.length) {
        var m = el('div', 'ca-actions');
        r.reply.menu.forEach(function (x) { var k = el('button', 'ca-opt', x.key + '. ' + x.label); k.type = 'button'; k.onclick = function () { send(x.key, x.label); }; m.append(k); });
        b.append(m);
      }
    }

    function send(text, shown) {
      if (!text) return;
      bubble('me', shown || text);
      ct.message(text).then(render).catch(function (e) { bubble('err', 'Service indisponible : ' + e.message); });
    }
    form.onsubmit = function (e) { e.preventDefault(); var t = input.value.trim(); input.value = ''; send(t); };

    // Micro : l'audio part au moteur, qui le transcrit puis le comprend comme du texte.
    var rec = null, chunks = [];
    mic.onclick = function () {
      if (rec) { rec.stop(); return; }
      if (!navigator.mediaDevices) { bubble('err', 'Micro indisponible sur ce navigateur.'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        chunks = []; rec = new MediaRecorder(stream);
        rec.ondataavailable = function (e) { chunks.push(e.data); };
        rec.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          mic.classList.remove('ca-rec'); rec = null;
          ct.voice(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' })).then(function (v) {
            if (v.transcript && v.transcript.text) bubble('me', 'Entendu : ' + v.transcript.text);
            if (v.result) render(v.result); else bubble('err', v.note || 'Rien n’a été reconnu.');
          }).catch(function (e) { bubble('err', 'Reconnaissance vocale indisponible : ' + e.message); });
        };
        rec.start(); mic.classList.add('ca-rec');
      }).catch(function () { bubble('err', 'Accès au micro refusé.'); });
    };
    return { client: ct, send: send };
  }
  g.MonNkapAssistant = { mount: mount };
})(window);
