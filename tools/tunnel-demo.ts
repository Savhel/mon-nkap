// Prépare le tunnel de démonstration : la page Conversation (/mobile) et les autres pages de démonstration deviennent
// joignables depuis Internet, derrière un identifiant et un mot de passe ; le middleware SAFINUM et la collecte des
// natifs restent ouverts comme avant ; l'administration reste fermée à tous.
//   node --env-file=.env tools/tunnel-demo.ts          écrit services/ngrok-demo.local.yml (jamais envoyé sur GitHub)
// puis : ngrok http 8080 --traffic-policy-file services/ngrok-demo.local.yml
// Le mot de passe est CT_DEMO_PASSWORD dans .env ; s'il manque, il est créé et ajouté à .env.
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const user = process.env.CT_DEMO_USER ?? 'gifa';
let password = process.env.CT_DEMO_PASSWORD ?? '';
if (!password) {
  password = randomBytes(9).toString('base64url');
  appendFileSync(new URL('../.env', import.meta.url), `\n# Mot de passe des pages de démonstration par le tunnel (tools/tunnel-demo.ts)\nCT_DEMO_PASSWORD=${password}\n`);
  console.log('Mot de passe créé et ajouté à .env (CT_DEMO_PASSWORD).');
}
if (!/^[\w.~-]{6,}$/.test(password) || !/^[\w.-]+$/.test(user)) {
  console.error('CT_DEMO_USER et CT_DEMO_PASSWORD : lettres, chiffres, « - », « _ », « . » seulement (6 caractères au moins).');
  process.exit(1);
}

const OPEN = "req.url.path == '/safinum/middleware' || req.url.path == '/collecte' || req.url.path.startsWith('/v1/collecte/') || req.url.path == '/tokens.css' || req.url.path == '/icon.svg'";
const ADMIN = "req.url.path == '/admin' || req.url.path.startsWith('/v1/admin')";
const policy = `# Généré par tools/tunnel-demo.ts — contient le mot de passe de démonstration : ne pas envoyer sur GitHub.
on_http_request:
  - expressions:
      - "${ADMIN}"
    actions:
      - type: custom-response
        config:
          status_code: 404
          body: "introuvable"
  - expressions:
      - "!(${OPEN})"
    actions:
      - type: basic-auth
        config:
          realm: "Mon Nkap - demonstration"
          credentials:
            - "${user}:${password}"
`;
writeFileSync(new URL('../services/ngrok-demo.local.yml', import.meta.url), policy);
console.log(`Écrit : services/ngrok-demo.local.yml (identifiant « ${user} », mot de passe : CT_DEMO_PASSWORD dans .env).`);
console.log('Relancer ngrok : ngrok http 8080 --traffic-policy-file services/ngrok-demo.local.yml');
console.log('Page Conversation : https://audrina-nonintroverted-timorously.ngrok-free.dev/mobile');
