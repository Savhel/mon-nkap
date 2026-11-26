(function () {
  const client = MonNkap.connect('');
  const status = document.getElementById('language-status');
  const wrapper = document.getElementById('language-matrix');
  const add = (parent, tag, text) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    parent.append(element);
    return element;
  };
  const form = document.getElementById('trial-form');
  const replay = document.getElementById('trial-replay');
  const paths = { mobile: '/mobile', web: '/banque', ussd: '/canaux' };
  const phrases = {
    fub: (amount, name) => `a yidi yerbinego ${amount} FCFA ha ${name} na`,
    ewo: (amount, name) => `lóm mɔ́nə ${amount} FCFA à ${name}`,
    dua: (amount, name) => `lóma mɔ́ni ${amount} FCFA à ${name}`,
    fr: (amount, name) => `Envoie ${amount} FCFA à ${name}`,
  };
  const params = new URLSearchParams(location.search);
  const makeTrial = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  let trial = /^[a-f0-9]{12}$/.test(params.get('trial') || '') ? params.get('trial') : makeTrial();

  function updateTrial() {
    const fields = new FormData(form);
    const values = { lang: fields.get('lang'), recipient: fields.get('recipient'), amount: fields.get('amount'), corrected: fields.get('corrected') };
    const valid = form.checkValidity();
    const value = replay.checked ? values.corrected : values.amount;
    const draft = valid ? phrases[values.lang](value, values.recipient) : '';
    document.getElementById('trial-request-label').textContent = values.lang === 'fr'
      ? 'Demande à relire' : 'Exemple du lexique · brouillon';
    document.getElementById('trial-request').textContent = draft || 'Entrez deux montants entre 1 et 50 000 FCFA.';
    document.getElementById('trial-correction').textContent = valid ? `Non, plutôt ${values.corrected} FCFA` : '—';
    document.getElementById('trial-reference').textContent = 'Essai ' + trial.toUpperCase();
    const home = new URLSearchParams({ trial, ...values, ...(replay.checked ? { replay: '1' } : {}) });
    history.replaceState(null, '', '?' + home + location.hash);
    document.getElementById('trial-dashboard').href = '/tableau?' + home;
    for (const [key, path] of Object.entries(paths)) {
      const link = document.getElementById('trial-' + key);
      if (valid) {
        const query = new URLSearchParams({ lang: values.lang, trial, draft });
        if (!replay.checked) query.set('correction', `Non, plutôt ${values.corrected} FCFA`);
        link.href = path + '?' + query + (key === 'ussd' ? '#ussd' : '');
      } else {
        link.removeAttribute('href');
      }
      link.setAttribute('aria-disabled', String(!valid));
    }
  }
  for (const name of ['lang', 'recipient', 'amount', 'corrected']) {
    const field = form.elements.namedItem(name);
    const value = params.get(name);
    if (value && (field.tagName !== 'SELECT' || [...field.options].some((option) => option.value === value))) field.value = value;
  }
  replay.checked = params.get('replay') === '1';
  form.addEventListener('input', updateTrial);
  form.addEventListener('submit', (event) => event.preventDefault());
  replay.addEventListener('change', updateTrial);
  document.getElementById('trial-new').onclick = () => { trial = makeTrial(); replay.checked = false; updateTrial(); };
  updateTrial();

  client.languages().then((registry) => {
    const table = add(wrapper, 'table');
    const header = add(add(table, 'thead'), 'tr');
    for (const title of ['Langue', 'Dialogue bancaire', 'Micro', 'Audio des réponses', 'Essayer']) add(header, 'th', title).scope = 'col';
    const body = add(table, 'tbody');
    for (const lang of MonNkap.demoLanguages(registry)) {
      const options = lang.experience || {};
      const row = add(body, 'tr');
      add(row, 'th', lang.name).scope = 'row';
      const banking = options.banking === 'none' ? '—' : MonNkap.languageLabel(lang);
      add(row, 'td', banking + (options.translation && options.banking !== 'translation' ? ' · traduction en appui' : options.documentedNumbers && options.banking !== 'mixed' ? ' · montants en lettres' : ''));
      add(row, 'td', options.microphone ? (options.banking === 'none' ? 'Transcription' : 'Disponible') : options.asr ? 'Modèle à charger' : '—');
      add(row, 'td', [options.clips && 'Clips enregistrés', options.synthesis && 'Synthèse configurée'].filter(Boolean).join(' · ') || 'Texte');
      const link = add(add(row, 'td'), 'a', 'Ouvrir');
      link.href = '/mobile?lang=' + encodeURIComponent(lang.code);
      link.setAttribute('aria-label', 'Ouvrir en ' + lang.name);
    }
    status.textContent = 'Les modes dépendent des modèles chargés et des ressources disponibles pour chaque langue.';
    wrapper.hidden = false;
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Tableau des modes disponibles par langue');
  }).catch(() => {
    status.textContent = 'Le registre des langues ne répond pas. Rechargez la page pour réessayer.';
  });
})();
