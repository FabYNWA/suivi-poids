# Mise en ligne de Suivi poids

L'appli est composée de deux morceaux :

- **le site** (ce dépôt), publié sur GitHub Pages ;
- **le relais** (`relay/worker.js`), un petit programme Cloudflare qui détient la clé Grist.

La clé Grist ne se trouve jamais sur le téléphone ni dans le code. L'appli ne connaît que le relais, et le relais exige ton code d'accès.

## 1. Le relais Cloudflare (environ 5 minutes)

1. Cloudflare → **Workers & Pages** → **Create** → **Create Worker**.
2. Nom : `suivi-poids`. Clique sur **Deploy**, puis **Edit code**.
3. Remplace tout le contenu par celui de `relay/worker.js`, puis **Deploy**.
4. Onglet **Settings** → **Variables and Secrets** → ajoute :

| Type | Nom | Valeur |
|---|---|---|
| Texte | `GRIST_HOST` | `https://fabienbois.getgrist.com` |
| Texte | `DOC_ID` | `9uHXcn9oEnKmwhb5Swyz3H` |
| Texte | `ALLOWED_ORIGIN` | `https://fabynwa.github.io` |
| Secret | `GRIST_API_KEY` | ta clé API Grist (Grist → ton profil → Réglages → API) |
| Secret | `APP_CODE` | un code d'accès long, par exemple quatre mots (c'est lui que tu taperas dans l'appli) |

5. Vérification : ouvre `https://suivi-poids.fabien-rm-bois.workers.dev/poids` dans le navigateur.
   La page doit répondre `Code incorrect.` Si c'est le cas, le relais est en ligne.

Si Cloudflare t'a donné une autre adresse que `suivi-poids.fabien-rm-bois.workers.dev`, mets-la dans `config.js`.

## 2. Le site sur GitHub Pages

1. Dépôt `suivi-poids` → **Settings** → **Pages**.
2. **Source** : Deploy from a branch → branche `main`, dossier `/ (root)` → **Save**.
3. Après une minute, le site est sur `https://fabynwa.github.io/suivi-poids/`.

## 3. Installer sur le téléphone

1. Ouvre l'adresse du site dans Chrome.
2. Menu ⋮ → **Ajouter à l'écran d'accueil** → **Installer**.
3. Ouvre l'appli depuis l'icône, tape ton code d'accès une seule fois.

## Entretien

- **Changer le code d'accès** : Cloudflare → le Worker → Settings → `APP_CODE`. L'appli redemande alors le code.
- **Perte du téléphone** : change `APP_CODE` (ou supprime la clé API dans Grist). Rien d'autre n'est à faire.
- **Mettre à jour l'appli** : modifier les fichiers du dépôt. Pour forcer le rechargement sur le téléphone, changer `VERSION` dans `sw.js`.

## Tests

```
node --test tests/*.test.mjs
```

Ils couvrent le relais (code, origine, bornes des valeurs, requête envoyée à Grist) et la logique de l'appli (dates, comparatifs, records, recherche).
