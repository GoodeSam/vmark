# Lint Markdown

VMark embarque un moteur de lint intégré qui détecte les **problèmes de correction**, pas les préférences de style. Le lint s'exécute à la demande (`Alt + Mod + V` ou **Affichage → Vérifier le Markdown**) et présente les résultats en ligne — une barre colorée le long de chaque bloc concerné en mode WYSIWYG, un soulignement ondulé sous le texte exact en mode Source — avec un badge dans la barre d'état et une navigation F2 entre les diagnostics.

## Ce que le lint est et n'est pas

Le lint de VMark est un vérificateur de **correction**&nbsp;:

- Références croisées cassées
- Références de lien non définies (les références de note de bas de page ne sont pas vérifiées)
- Blocs de code délimités non fermés
- Tableaux avec un nombre de colonnes incohérent
- Niveaux de titre qui sautent (h1 → h3)
- Images sans texte alternatif
- Texte de lien vide ou `href` vide

Le lint de VMark n'est **pas** un applicateur de style. Il ne signalera pas&nbsp;:

- Longueur de ligne
- Style de marqueur de liste (`-` vs `*`)
- Style de marqueur d'emphase (`_` vs `*`)
- Style de titre (`#` vs souligné)
- Espaces de fin de ligne

Pour l'application du style, utilisez un outil distinct comme `prettier --check` en dehors de VMark.

## Référence des règles

| ID de règle | Gravité | Description |
|-------------|---------|-------------|
| **E01** | Erreur | Référence non définie&nbsp;: `[lien][manquant]` pointe vers une définition qui n'existe pas |
| **E02** | Erreur | La ligne de tableau a un nombre de colonnes erroné (incohérence avec la ligne d'en-tête) |
| **E03** | Erreur | Lien inversé — ressemble à `(texte)[url]` au lieu de `[texte](url)` |
| **E04** | Erreur | Titre ATX manquant un espace après `#` (par ex. `##Titre` devrait être `## Titre`) |
| **E05** | Erreur | Espace à l'intérieur des marqueurs d'emphase — `* mot *` ne s'affichera pas en italique |
| **E06** | Erreur | Bloc de code délimité non fermé — le fichier se termine par une fence ```` ``` ```` ouverte |
| **E07** | Erreur | Définition de référence de lien dupliquée (le même `[label]:` apparaît deux fois) |
| **E08** | Erreur | `href` de lien vide — `[texte]()` |
| **W01** | Avertissement | Niveau de titre sauté (h2 attendu, h3 trouvé) |
| **W02** | Avertissement | Image manquant un texte alternatif — accessibilité |
| **W03** | Avertissement | Définition de référence de lien inutilisée (définie mais jamais liée) |
| **W04** | Avertissement | Le fragment d'ancre ne correspond à aucun titre — `#section` pour une section qui n'existe pas |
| **W05** | Avertissement | Texte de lien vide — `[](url)` |
| **M001** | Erreur | Fichier image introuvable au chemin local |
| **M002** | Erreur | Fichier lié introuvable au chemin local |
| **Y001** | Erreur | Erreur d'analyse YAML (pour les fichiers YAML) |
| **Y002** | Avertissement | Avertissement d'analyse YAML (pour les fichiers YAML) |

## Déclenchement du lint

| Déclencheur | Action |
|---|---|
| `Alt + Mod + V` | Exécuter le lint sur le document actif |
| **Affichage → Vérifier le Markdown** | Identique au raccourci |
| `F2` | Sauter au diagnostic suivant |
| `Shift + F2` | Sauter au diagnostic précédent |

Pour les fichiers markdown avec des chemins de fichiers, la vérification de l'existence des liens s'exécute automatiquement aux côtés des règles synchrones — voir [Vérification des liens](/fr/guide/link-check).

Pour les fichiers YAML, les erreurs d'analyse apparaissent en direct dans la gouttière au fur et à mesure de votre saisie, et le même raccourci `Alt + Mod + V` alimente le badge + la navigation F2.

## Paramètres

Le moteur de lint a un seul interrupteur visible par l'utilisateur&nbsp;:

- **Paramètres → Markdown → Activer le lint markdown** — activer ou désactiver entièrement le moteur

Lorsqu'il est désactivé, le raccourci devient un no-op et aucun diagnostic n'apparaît dans l'éditeur.

## Voir aussi

- [Vérification des liens](/fr/guide/link-check) — détection des liens / images locaux cassés
- [Paramètres → Markdown → Lint](/fr/guide/settings#lint)
