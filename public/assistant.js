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
  // Icônes au trait (style Lucide), jamais d'émoji.
  var ICONS = {
    wallet: ['M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z', 'M3 7l12-4v4', 'M16 14h.01'],
    send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4z'],
    receipt: ['M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z', 'M9 8h6', 'M9 12h6'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'],
    bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
    mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  };
  var QUICK = [['Solde', 'solde', 'wallet'], ['Envoyer', 'envoyer de l’argent', 'send'], ['Frais', 'frais', 'receipt'], ['Historique', 'historique', 'clock'], ['Crédit', 'acheter du crédit', 'phone'], ['Facture', 'payer une facture', 'bolt']];
  var SVG = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(name, size) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', String(size || 18)); s.setAttribute('height', String(size || 18)); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    ICONS[name].forEach(function (d) { var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); });
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
    QUICK.forEach(function (q) { var b = el('button', 'ca-chip'); b.type = 'button'; b.append(icon(q[2]), document.createTextNode(q[0])); b.onclick = function () { send(q[1], q[0]); }; quick.append(b); });
    var form = el('form', 'ca-form');
    var input = el('input', 'ca-input'); input.placeholder = 'Écrivez ou parlez dans votre langue…'; input.setAttribute('aria-label', 'Votre demande');
    var mic = el('button', 'ca-mic'); mic.type = 'button'; mic.setAttribute('aria-label', 'Parler'); mic.append(icon('mic', 20));
    var go = el('button', 'ca-send', 'Envoyer'); go.type = 'submit';
    form.append(input, mic, go);
    root.append(top, log, quick, form);
    var empty = el('div', 'ca-empty');
    empty.append(el('b', null, 'Bonjour'), el('span', null, 'Écrivez ou dites votre demande dans votre langue, ou choisissez une action ci-dessous.'));
    log.append(empty);
    var showDetails = false;
    info.onclick = function () { showDetails = !showDetails; info.setAttribute('aria-pressed', String(showDetails)); root.classList.toggle('ca-details', showDetails); };

    ct.languages().then(function (reg) {
      (reg.languages || []).filter(function (l) { return l.capabilities && l.capabilities.understanding && l.capabilities.understanding.status !== 'unavailable'; })
        .forEach(function (l) { var o = el('option', null, l.native || l.name); o.value = l.code; langSel.append(o); });
      langSel.value = opts.lang || 'fr';
    }).catch(function () { var o = el('option', null, 'Français'); o.value = 'fr'; langSel.append(o); });
    langSel.onchange = function () { ct.setLang(langSel.value); };

    function bubble(who, text) { if (empty.parentNode) empty.remove(); var b = el('div', 'ca-b ca-' + who, text); log.append(b); log.scrollTop = log.scrollHeight; return b; }
    // Attente de la réponse : indicateur visible, boutons désactivés (pas de double envoi), état annoncé aux lecteurs d'écran.
    var typing = el('div', 'ca-typing'); typing.setAttribute('aria-label', 'Réponse en cours'); typing.append(el('i'), el('i'), el('i'));
    function busy(on) {
      root.setAttribute('aria-busy', String(on));
      [go, mic, input].concat([].slice.call(quick.querySelectorAll('button'))).forEach(function (b) { b.disabled = on; });
      if (on) { log.append(typing); log.scrollTop = log.scrollHeight; } else if (typing.parentNode) typing.remove();
    }

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
        yes.onclick = function () { yes.disabled = no.disabled = true; busy(true); ct.confirm(c.confirmationToken).then(function (x) { busy(false); render(x); }).catch(function (e) { busy(false); bubble('err', 'Confirmation refusée : ' + e.message); }); };
        no.onclick = function () { yes.disabled = no.disabled = true; send('2', 'Annuler'); };
        row.append(yes, no); b.append(row);
      } else if (r.reply.menu && r.reply.menu.length) {
        var m = el('div', 'ca-actions');
        r.reply.menu.forEach(function (x) { var k = el('button', 'ca-opt', x.key + '. ' + x.label); k.type = 'button'; k.onclick = function () { send(x.key, x.label); }; m.append(k); });
        b.append(m);
      }
    }

    function send(text, shown) {
      if (!text || root.getAttribute('aria-busy') === 'true') return;
      bubble('me', shown || text);
      busy(true);
      ct.message(text).then(function (r) { busy(false); render(r); input.focus(); })
        .catch(function (e) { busy(false); bubble('err', 'Service indisponible : ' + e.message); });
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
          busy(true);
          ct.voice(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' })).then(function (v) {
            busy(false);
            if (v.transcript && v.transcript.text) bubble('me', 'Entendu : ' + v.transcript.text);
            if (v.result) render(v.result); else bubble('err', v.note || 'Rien n’a été reconnu.');
          }).catch(function (e) { busy(false); bubble('err', 'Reconnaissance vocale indisponible : ' + e.message); });
        };
        rec.start(); mic.classList.add('ca-rec');
      }).catch(function () { bubble('err', 'Accès au micro refusé.'); });
    };
    return { client: ct, send: send };
  }
  g.MonNkapAssistant = { mount: mount };
})(window);
