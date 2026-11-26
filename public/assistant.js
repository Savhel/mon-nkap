// Composant « assistant financier dans votre langue », partagé par l'application mobile et le widget web.
// Il ne contient aucune intelligence : il affiche ce que renvoie le moteur commun (via sdk.js).
//   var a = MonNkapAssistant.mount(element, { server: '', channel: 'mobile', lang: 'ewo' })
//   Options : bare (sans barre du haut : l'application fournit langue et détails), quick ([libellé, demande, icône]),
//             empty ({ title, text }), onLang(code) (le moteur a changé de langue).
//   Retour  : { client, send, setLang, setDetails, setQuick, focus }
// Tout texte venant du serveur est inséré avec textContent (jamais interprété comme du HTML).
(function (g) {
  var QUALITY = {
    validated: ['Validé par des natifs', 'ok'],
    draft: ['Brouillon, non relu par des natifs', 'warn'],
    machine: ['Traduction automatique', 'warn'],
    fallback: ['Réponse en français (phrase pas encore traduite)', 'muted'],
  };
  // Icônes au trait (famille Lucide), jamais d'émoji.
  var ICONS = {
    wallet: ['M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z', 'M3 7l12-4v4', 'M16 14h.01'],
    send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4z'],
    receipt: ['M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z', 'M9 8h6', 'M9 12h6'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'],
    bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
    mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
    stop: ['M7 7h10v10H7z'],
    arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
    check: ['M20 6 9 17l-5-5'],
    checkCircle: ['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'M22 4 12 14l-3-3'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
    globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z'],
    chevronLeft: ['M15 18l-6-6 6-6'],
    chevronRight: ['M9 18l6-6-6-6'],
    code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    eyeOff: ['M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9', 'M9.9 4.2A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M2 2l20 20'],
    message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    x: ['M18 6 6 18', 'M6 6l12 12'],
    volume: ['M11 5 6 9H2v6h4l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  };
  var QUICK = [['Solde', 'solde', 'wallet'], ['Envoyer', 'envoyer de l’argent', 'send'], ['Frais', 'frais', 'receipt'], ['Historique', 'historique', 'clock'], ['Crédit', 'acheter du crédit', 'phone'], ['Facture', 'payer une facture', 'bolt']];
  var SVG = 'http://www.w3.org/2000/svg';
  var REF = { fr: 1, en: 1 };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(name, size) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', String(size || 18)); s.setAttribute('height', String(size || 18)); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    (ICONS[name] || []).forEach(function (d) { var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); });
    return s;
  }
  /** 150000 → « 150 000 FCFA » (espace fine insécable ; les chiffres ne sont jamais traduits). */
  function money(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA'; }

  function mount(root, opts) {
    opts = opts || {};
    var ct = g.MonNkap.connect(opts.server || '', { channel: opts.channel || 'web', lang: opts.lang || 'fr', apiKey: opts.apiKey || '', trial: opts.trial });
    var lang = opts.lang || 'fr';
    root.classList.add('ca');
    var langSel = null, info = null;
    if (!opts.bare) {
      var top = el('div', 'ca-top');
      langSel = el('select', 'ca-lang'); langSel.setAttribute('aria-label', 'Langue');
      info = el('button', 'ca-ghost', 'Détails techniques'); info.type = 'button'; info.setAttribute('aria-pressed', 'false');
      top.append(langSel, info);
      root.append(top);
    }
    var log = el('div', 'ca-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
    var quick = el('div', 'ca-quick');
    var form = el('form', 'ca-form');
    var mode = el('p', 'ca-mode'); mode.hidden = true; mode.setAttribute('role', 'status');
    var input = el('input', 'ca-input'); input.placeholder = 'Écrivez votre demande…'; input.setAttribute('aria-label', 'Votre demande'); input.autocomplete = 'off';
    if (opts.draft) input.value = opts.draft.slice(0, 160);
    var mic = el('button', 'ca-mic'); mic.type = 'button'; mic.setAttribute('aria-label', 'Parler'); mic.append(icon('mic', 20));
    var go = el('button', 'ca-send'); go.type = 'submit'; go.setAttribute('aria-label', 'Envoyer'); go.append(icon('arrowUp', 20));
    form.append(input, mic, go);
    root.append(mode, log, quick, form);
    var empty = el('div', 'ca-empty');
    var badge = el('span', 'ca-empty-ico'); badge.append(icon('message', 26));
    var e = opts.empty || { title: 'Bonjour', text: 'Écrivez ou dites votre demande dans votre langue, ou choisissez une action ci-dessous.' };
    empty.append(badge, el('b', null, e.title), el('span', null, e.text));
    log.append(empty);

    function setQuick(list) {
      quick.textContent = '';
      (list || QUICK).forEach(function (q) {
        var b = el('button', 'ca-chip'); b.type = 'button';
        b.append(icon(q[2]), document.createTextNode(q[0]));
        b.onclick = function () { send(q[1], q[0]); };
        quick.append(b);
      });
    }
    setQuick(opts.quick);
    function setDetails(on) { root.classList.toggle('ca-details', !!on); if (info) info.setAttribute('aria-pressed', String(!!on)); }
    function setLang(code) { lang = code; ct.setLang(code); if (langSel) langSel.value = code; updateMode(); }

    var runtime = {}, registry = [];
    function selectedLanguage() { return registry.find(function (l) { return l.code === lang; }); }
    function canBank() { return selectedLanguage()?.experience?.banking !== 'none'; }
    function canRecord() { return selectedLanguage()?.experience?.microphone ?? (runtime.speechToText !== false); }
    function updateMode() {
      var selected = selectedLanguage();
      mode.hidden = !selected;
      if (selected) {
        var parts = [g.MonNkap.languageLabel(selected)];
        if (selected.experience?.microphone && canBank()) parts.push('Micro avec transcription à relire');
        if (!canRecord() && selected.experience?.asr) parts.push('Micro indisponible sur ce serveur');
        mode.textContent = parts.join(' · ');
      }
      root.classList.toggle('ca-transcript-only', !canBank());
      quick.hidden = !canBank();
      go.hidden = !canBank();
      mic.disabled = !canRecord();
      mic.title = canRecord() ? 'Parler' : 'Micro indisponible pour cette langue';
      mic.setAttribute('aria-label', mic.title);
      input.placeholder = canBank() ? 'Écrivez votre demande…' : 'Votre transcription modifiable';
    }
    ct.languages().then(function (reg) {
      runtime = reg.runtime || {};
      registry = g.MonNkap.demoLanguages(reg);
      if (langSel) {
        registry.forEach(function (language) {
          var option = el('option', null, language.native || language.name);
          option.value = language.code;
          langSel.append(option);
        });
        if (!selectedLanguage() && registry.length) setLang(registry[0].code);
        langSel.value = lang;
      }
      updateMode();
    }).catch(function () { if (langSel) { var o = el('option', null, 'Français'); o.value = 'fr'; langSel.append(o); } });
    if (langSel) {
      var showDetails = false;
      info.onclick = function () { showDetails = !showDetails; setDetails(showDetails); };
      langSel.onchange = function () { setLang(langSel.value); };
    }

    function scroll() { log.scrollTop = log.scrollHeight; }
    function bubble(who, text) { if (empty.parentNode) empty.remove(); var b = el('div', 'ca-b ca-' + who, text); log.append(b); scroll(); return b; }
    // Attente de la réponse : indicateur visible, boutons désactivés (pas de double envoi), état annoncé aux lecteurs d'écran.
    var typing = el('div', 'ca-typing'); typing.setAttribute('aria-label', 'Réponse en cours'); typing.append(el('i'), el('i'), el('i'));
    function busy(on) {
      root.setAttribute('aria-busy', String(on));
      [go, input].concat([].slice.call(quick.querySelectorAll('button'))).forEach(function (b) { b.disabled = on; });
      mic.disabled = on || !canRecord();
      if (langSel) langSel.disabled = on;
      if (on) { log.append(typing); scroll(); } else if (typing.parentNode) typing.remove();
    }

    function receiptRow(t, label, value, strong) {
      var d = el('div', strong ? 'ca-r-total' : null);
      d.append(el('dt', null, label), el('dd', null, value)); t.append(d);
    }
    /** Récapitulatif chiffré : les valeurs qui comptent, en grand, jamais traduites. */
    function receipt(ent) {
      var t = el('dl', 'ca-receipt');
      if (ent.beneficiary) receiptRow(t, 'Bénéficiaire', ent.beneficiary.name + (ent.beneficiary.phone ? '\n' + ent.beneficiary.phone : ''));
      else if (ent.biller) receiptRow(t, 'Fournisseur', String(ent.biller));
      else if (ent.phone) receiptRow(t, 'Numéro', String(ent.phone));
      if (typeof ent.amount === 'number') receiptRow(t, 'Montant', money(ent.amount));
      if (typeof ent.fee === 'number') receiptRow(t, 'Frais', money(ent.fee));
      if (typeof ent.total === 'number') receiptRow(t, 'Total débité', money(ent.total), true);
      return t;
    }

    function render(r) {
      if (r.lang && r.lang !== lang) { setLang(r.lang); if (opts.onLang) opts.onLang(r.lang); }
      var c = r.canonical || {}, ent = c.entities || {};
      var done = r.status === 'executed';
      var b = bubble('bot', null);
      if (done) {
        b.classList.add('ca-done');
        var head = el('div', 'ca-done-head'); head.append(icon('checkCircle', 22), el('b', null, 'Opération effectuée'));
        b.append(head);
      }
      if (r.reply.localizedIntro) {
        b.append(el('p', 'ca-mt-intro', r.reply.localizedIntro.text), el('small', 'ca-q ca-warn', 'Annonce traduite automatiquement'));
      }
      b.append(el('div', 'ca-text', r.reply.text));
      if (!REF[r.lang]) {
        var q = QUALITY[r.reply.quality] || QUALITY.fallback;
        b.append(el('span', 'ca-q ca-' + q[1], q[0]));
        if (r.reply.quality !== 'validated' && r.reply.fr && r.reply.fr !== r.reply.text) {
          var fr = el('details', 'ca-fr'); fr.append(el('summary', null, 'Voir en français'), el('p', null, r.reply.fr)); b.append(fr);
        }
      }
      var nativeAudio = r.reply.speech && r.reply.speech.length && !REF[r.lang] && selectedLanguage()?.experience?.clips;
      var cloudAudio = (runtime.plotweaver || []).includes(r.lang) && r.reply.quality !== 'fallback';
      var piperAudio = (runtime.piper || []).includes(r.lang);
      if (nativeAudio || cloudAudio || piperAudio) {
        var listen = el('button', 'ca-listen'); listen.type = 'button';
        listen.append(icon('volume', 16), document.createTextNode('Écouter'));
        listen.onclick = async function () {
          listen.disabled = true;
          try {
            var blob = null, source = '';
            if (nativeAudio) {
              var q = 'lang=' + encodeURIComponent(r.lang) + '&clips=' + r.reply.speech.map(encodeURIComponent).join(',');
              var nativeResponse = await fetch((opts.server || '') + '/v1/native?' + q);
              if (nativeResponse.ok) { blob = await nativeResponse.blob(); source = 'Voix enregistrée'; }
            }
            if (!blob && cloudAudio) { blob = await ct.speech(r); source = 'Synthèse PlotWeaver'; }
            if (!blob && piperAudio) {
              var res = await fetch((opts.server || '') + '/v1/tts?lang=' + r.lang + '&text=' + encodeURIComponent(r.reply.text));
              if (res.ok) { blob = await res.blob(); source = 'Synthèse Piper'; }
            }
            if (!blob) { listen.textContent = 'Audio indisponible pour cette réponse'; return; }
            var url = URL.createObjectURL(blob);
            var audio = el('audio'); audio.controls = true; audio.src = url; audio.setAttribute('aria-label', source);
            listen.replaceWith(el('span', 'ca-q', source), audio);
            await audio.play().catch(function () {});
          } catch { listen.textContent = 'Audio indisponible pour cette réponse'; }
          finally { listen.disabled = false; }
        };
        b.append(listen);
      }
      b.append(el('pre', 'ca-canon', JSON.stringify({ operation: c.operation, act: c.act, entities: c.entities, status: c.status, confidence: c.confidence }, null, 1)));
      if (r.status === 'awaiting_confirmation' && c.confirmationToken) {
        b.classList.add('ca-confirm');
        if (typeof ent.amount === 'number') b.append(receipt(ent));
        var note = el('p', 'ca-safe'); note.append(icon('shield', 16), document.createTextNode('Rien n’est envoyé avant votre confirmation.'));
        b.append(note);
        var m = r.reply.menu || [];
        var native = !REF[r.lang];
        var row = el('div', 'ca-actions');
        var yes = el('button', 'ca-yes'); yes.type = 'button';
        var no = el('button', 'ca-no'); no.type = 'button';
        yes.append(el('span', null, native && m[0] ? m[0].label : 'Confirmer'));
        no.append(el('span', null, native && m[1] ? m[1].label : 'Annuler'));
        if (native) { yes.append(el('small', null, 'Confirmer')); no.append(el('small', null, 'Annuler')); }
        yes.onclick = function () { yes.disabled = no.disabled = true; busy(true); ct.confirm(c.confirmationToken).then(function (x) { busy(false); render(x); }).catch(function (err) { busy(false); bubble('err', 'Confirmation refusée : ' + err.message); }); };
        no.onclick = function () { yes.disabled = no.disabled = true; send('2', native && m[1] ? m[1].label : 'Annuler'); };
        row.append(no, yes); b.append(row);
        if (opts.trial && opts.correction && c.act !== 'CORRECT') {
          var correct = el('button', 'ca-listen ca-actions', 'Préparer la correction de l’essai');
          correct.type = 'button';
          correct.onclick = function () {
            input.value = opts.correction.slice(0, 120);
            input.focus();
          };
          b.append(correct);
        }
      } else if (done && (ent.reference || (r.params && typeof r.params.balance === 'number'))) {
        var t = el('dl', 'ca-receipt');
        if (ent.reference) receiptRow(t, 'Référence', String(ent.reference));
        if (r.params && typeof r.params.balance === 'number') receiptRow(t, 'Nouveau solde', money(r.params.balance), true);
        b.append(t);
      } else if (r.reply.menu && r.reply.menu.length) {
        var opt = el('div', 'ca-actions ca-menu');
        r.reply.menu.forEach(function (x) { var k = el('button', 'ca-opt'); k.type = 'button'; k.append(el('span', 'ca-key', x.key), el('span', null, x.label)); k.onclick = function () { send(x.key, x.label); }; opt.append(k); });
        b.append(opt);
      }
      scroll();
    }

    function send(text, shown) {
      if (!text || !canBank() || root.getAttribute('aria-busy') === 'true') return;
      bubble('me', shown || text);
      busy(true);
      ct.message(text).then(function (r) { busy(false); render(r); })
        .catch(function (err) { busy(false); bubble('err', 'Service indisponible : ' + err.message); });
    }
    form.onsubmit = function (ev) { ev.preventDefault(); if (!canBank()) return; var t = input.value.trim(); input.value = ''; send(t); };

    // Le micro remplit le champ. La personne relit la transcription avant de l’envoyer.
    var rec = null, chunks = [];
    mic.onclick = function () {
      if (rec) { rec.stop(); return; }
      if (!canRecord()) { bubble('err', 'Micro indisponible sur ce serveur. Vous pouvez écrire votre demande.'); return; }
      if (!navigator.mediaDevices) { bubble('err', 'Micro indisponible sur cet appareil.'); return; }
      if (!window.MediaRecorder) { bubble('err', 'Ce navigateur ne peut pas enregistrer le son.'); return; }
      mic.disabled = true;
      var recordedLang = lang;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        chunks = [];
        try { rec = new MediaRecorder(stream); }
        catch (err) { stream.getTracks().forEach(function (track) { track.stop(); }); throw err; }
        rec.ondataavailable = function (ev) { chunks.push(ev.data); };
        var limit = setTimeout(function () { if (rec && rec.state === 'recording') rec.stop(); }, 19000);
        rec.onstop = function () {
          clearTimeout(limit);
          stream.getTracks().forEach(function (t) { t.stop(); });
          mic.classList.remove('ca-rec'); mic.setAttribute('aria-label', 'Parler'); mic.replaceChildren(icon('mic', 20)); rec = null;
          if (lang !== recordedLang) return;
          busy(true);
          ct.voice(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' }), { transcribeOnly: true }).then(function (v) {
            busy(false);
            if (lang !== recordedLang) return;
            if (!v.transcript?.text) { bubble('err', v.note || 'Rien n’a été reconnu.'); return; }
            input.value = v.transcript.text;
            input.focus();
            mode.hidden = false;
            mode.textContent = canBank() ? 'Relisez la transcription et envoyez votre demande.' : 'Vous pouvez modifier ou copier cette transcription.';
          }).catch(function (err) { busy(false); bubble('err', 'Reconnaissance vocale indisponible : ' + err.message); });
        };
        rec.start(); mic.disabled = false; mic.classList.add('ca-rec'); mic.setAttribute('aria-label', 'Arrêter l’enregistrement'); mic.replaceChildren(icon('stop', 20));
      }).catch(function () { mic.disabled = !canRecord(); bubble('err', 'Impossible d’accéder au micro.'); });
    };
    return { client: ct, send: send, setLang: setLang, setDetails: setDetails, setQuick: setQuick, focus: function () { input.focus(); } };
  }
  g.MonNkapAssistant = { mount: mount, icon: icon, money: money };
})(window);
