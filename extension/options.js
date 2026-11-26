const $ = (id) => document.getElementById(id);

chrome.runtime.sendMessage({ type: 'NKAP_GET_CONFIG' }).then((res) => {
  if (res?.ok) {
    $('srv').value = res.config.serverUrl;
    $('key').value = res.config.apiKey;
    $('draft').checked = res.config.allowDraft;
  }
});

$('f').onsubmit = async (e) => {
  e.preventDefault();
  const res = await chrome.runtime.sendMessage({
    type: 'NKAP_SET_CONFIG',
    config: { serverUrl: $('srv').value.trim(), apiKey: $('key').value.trim(), allowDraft: $('draft').checked },
  });
  $('msg').textContent = res?.ok ? 'Configuration enregistrée.' : (res?.error || 'Erreur');
};

