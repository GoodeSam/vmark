# Vérification des liens

VMark vérifie que les cibles locales de liens et d'images dans votre markdown existent réellement sur le disque. S'exécute aux côtés du [moteur de lint markdown](/fr/guide/lint) sur `Alt + Mod + V` ou **Affichage → Vérifier le Markdown**.

## Ce qui est vérifié

Pour chaque lien et image local dans le document&nbsp;:

- `[texte](./other.md)` — le fichier `./other.md` se résout et existe
- `![alt](./image.png)` — le fichier image existe
- `[texte](./other.md#section)` — le fichier existe (la vérification d'ancre est gérée par la [règle `linkFragments`](/fr/guide/lint#reference-des-regles))

Lorsqu'une cible est manquante, une entrée apparaît dans le badge de lint et dans la navigation `F2` / `Shift + F2`. Son affichage dépend du mode&nbsp;: en mode Source, le lien reçoit le soulignement de diagnostic rouge de CodeMirror&nbsp;; en mode WYSIWYG, tout le bloc contenant le lien est marqué d'une barre rouge le long de son bord gauche et d'une légère teinte — les marques de lint en WYSIWYG sont au niveau du bloc, jamais un soulignement en ligne.

## Ce qui est ignoré

- **Liens fragments uniquement** (`#ancre`) — gérés par la règle `linkFragments` qui vérifie par rapport aux titres du document actuel
- **URL externes** — tout schéma d'URI (`http:`, `https:`, `mailto:`, `obsidian:`, `vscode:`, …) et les URL relatives au protocole `//host/…`. Les chemins Windows avec lettre de lecteur (`C:\…`, `C:/…`) sont tout de même vérifiés comme chemins de fichiers
- **Documents sans titre** — sans chemin de fichier enregistré, les URL relatives ne peuvent pas être résolues par rapport à un répertoire
- **Chemins réseau et chemins relatifs à un lecteur** — un chemin UNC (`\\server\share\…`) n'est jamais consulté, car le vérifier sous Windows contacterait cet hôte via le réseau (et pourrait lui proposer vos identifiants de connexion Windows). Un chemin relatif à un lecteur comme `C:file.md` (une lettre de lecteur sans barre oblique après) est également ignoré&nbsp;: il est relatif au répertoire de travail de l'application, pas au document

## Comment fonctionne la résolution

La vérification des liens résout un chemin relatif par rapport au répertoire du fichier source, et prend un chemin absolu comme le fichier qu'il désigne&nbsp;:

| Lien dans `/repo/docs/intro.md` | Se résout en |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md` (un chemin absolu désigne ce fichier&nbsp;; sous Windows, il se situe sur le lecteur du document lui-même) |

Les fragments sont supprimés avant la recherche du fichier — `[a](./other.md#section)` vérifie uniquement `./other.md`.

## Performance

- **Asynchrone** — s'exécute en parallèle avec les règles synchrones&nbsp;; les résultats fusionnent dès qu'ils sont prêts
- **Dédupliqué** — chaque chemin résolu unique est vérifié une fois par exécution, même s'il est lié plusieurs fois
- **Pas de déclenchement à la frappe** — un `fs.exists` à chaque frappe encombrerait&nbsp;; ne s'exécute que sur le déclencheur de lint explicite
- **Tolérance aux erreurs opérationnelles** — si `fs.exists` lève une exception (permission refusée, problème de portée de capacité), le résultat est `error` (ignoré), pas `missing`. Mieux vaut silencieux que faux.

## Codes de diagnostic

| Code | Gravité | Déclencheur |
|---|---|---|
| **M001** | Erreur | Fichier image introuvable au chemin local résolu |
| **M002** | Erreur | Fichier lié introuvable au chemin local résolu |

## Voir aussi

- [Lint Markdown](/fr/guide/lint) — référence complète des règles
- [Paramètres → Markdown → Lint](/fr/guide/settings#lint)
