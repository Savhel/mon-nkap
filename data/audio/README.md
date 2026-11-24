# Enregistrements natifs

Il n'existe aucune voix de synthèse pour les langues nationales. Le moteur parle donc avec de vrais enregistrements de locuteurs natifs, assemblés morceau par morceau.

- Un dossier par langue : `ewo/`, `dua/`, `fub/`, `wes/`…
- Un fichier par phrase, nommé exactement comme dans `docs/enregistrements.csv` (`balance_is.wav`, `n_5000.wav`, `name_marie_ngo_bassa.wav`…).
- Formats acceptés : wav, ogg, opus (notes vocales WhatsApp), m4a, mp3, webm. Les silences au début et à la fin sont coupés, et le volume est égalisé automatiquement.
- Si l'ordre des mots diffère du français, écrivez-le dans `plans.json` sans toucher au code. Exemple, quand le montant vient avant la phrase : `{ "balance": ["$balance", "balance_is"] }`.
- Pour voir ce qui manque : `GET /v1/native/coverage?lang=ewo`.

Une réponse n'est jouée avec la voix native que si **tous** ses morceaux sont enregistrés. Sinon, le canal garde son repli, qui est annoncé : réponse écrite, ou lue en français au serveur vocal.

Le consentement écrit de chaque locuteur est obligatoire avant de déposer ses enregistrements ici.
