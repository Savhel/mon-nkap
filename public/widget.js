// Widget « assistant dans votre langue » à intégrer dans N'IMPORTE QUELLE page bancaire, en une ligne :
//   <script src="https://<serveur>/widget.js" data-lang="fr" async></script>
// Le site de la banque n'est pas modifié : le widget ajoute un bouton flottant et un panneau, et parle au
// moteur commun (même API que l'USSD, le SMS, le mobile…).
(function () {
  var me = document.currentScript;
  var base = me ? new URL(me.src).origin : '';
  var lang = (me && me.dataset.lang) || 'fr';
  function load(tag, attrs) { return new Promise(function (ok, ko) { var e = document.createElement(tag); Object.assign(e, attrs); e.onload = ok; e.onerror = ko; document.head.append(e); }); }
  Promise.all([
    load('link', { rel: 'stylesheet', href: base + '/assistant.css' }),
    load('script', { src: base + '/sdk.js' }),
  ]).then(function () { return load('script', { src: base + '/assistant.js' }); }).then(function () {
    var css = document.createElement('style');
    css.textContent = '.ctw-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;background:#0f766e;color:#fff;font:600 15px system-ui,sans-serif;padding:14px 20px;min-height:48px;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer}'
      + '.ctw-panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:min(400px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.3)}'
      + '.ctw-panel[hidden]{display:none}';
    document.head.append(css);
    var btn = document.createElement('button'); btn.className = 'ctw-btn'; btn.type = 'button'; btn.textContent = 'Aide dans ma langue';
    btn.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('div'); panel.className = 'ctw-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Assistant dans votre langue');
    document.body.append(panel, btn);
    window.CamerounAssistant.mount(panel, { server: base, channel: 'web', lang: lang });
    btn.onclick = function () { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); };
  }).catch(function () { /* le site de la banque continue de fonctionner sans l'assistant */ });
})();
