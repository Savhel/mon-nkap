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
      add(row, 'td', banking + (options.translation && options.banking !== 'translation' ? ' · traduction en appui' : ''));
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
