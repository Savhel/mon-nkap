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
    load('link', { rel: 'stylesheet', href: base + '/tokens.css' }),
    load('link', { rel: 'stylesheet', href: base + '/assistant.css' }),
    load('script', { src: base + '/sdk.js' }),
  ]).then(function () { return load('script', { src: base + '/assistant.js' }); }).then(function () {
    var css = document.createElement('style');
    css.textContent = '.ctw-btn{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#0f172a;color:#fff;font:600 15px var(--nk-font,system-ui,sans-serif);padding:0 20px;min-height:52px;box-shadow:0 8px 24px rgba(2,6,23,.28);cursor:pointer;transition:transform 150ms}'
      + '.ctw-btn:hover{transform:translateY(-1px)}.ctw-btn:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}'
      + '.ctw-btn i{width:10px;height:10px;border-radius:50%;background:#a16207;box-shadow:0 0 0 3px rgba(161,98,7,.35)}'
      + '.ctw-panel{position:fixed;right:20px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:2147483000;width:min(400px,calc(100vw - 40px));height:min(620px,calc(100vh - 120px));border-radius:16px;overflow:hidden;border:1px solid rgba(15,23,42,.12);box-shadow:0 16px 48px rgba(2,6,23,.3)}'
      + '@media (max-width:480px){.ctw-panel{right:0;left:0;bottom:0;width:100vw;height:100dvh;border-radius:0}}'
      + '.ctw-panel[hidden]{display:none}';
    document.head.append(css);
    var btn = document.createElement('button'); btn.className = 'ctw-btn'; btn.type = 'button';
    btn.append(document.createElement('i'), document.createTextNode('Aide dans ma langue'));
    btn.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('div'); panel.className = 'ctw-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Assistant dans votre langue');
    document.body.append(panel, btn);
    window.MonNkapAssistant.mount(panel, { server: base, channel: 'web', lang: lang });
    btn.onclick = function () { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); };
  }).catch(function () { /* le site de la banque continue de fonctionner sans l'assistant */ });
})();
