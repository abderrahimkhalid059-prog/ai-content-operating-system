# ADR-015 — Domaine de contenu neutre et versions immuables

## Statut

Accepté pour la Phase 3A.

## Décision

Le contenu éditorial est stocké dans `ContentItem`, indépendamment de Blogger et de tout futur fournisseur. Son cycle éditorial (`ContentEditorialStatus`) est distinct de son état de publication externe (`ContentPublicationStatus`). La Phase 3A ne déclenche aucune publication.

Chaque création, modification, transition ou archivage produit un instantané `ContentRevision` immuable dans la même transaction que le contenu courant. Le numéro de version de `ContentItem` sert aussi de numéro de révision. Les écritures utilisent `expectedVersion` et une mise à jour conditionnelle; une version obsolète retourne `CONTENT_STALE_UPDATE` sans écraser le travail concurrent.

Les slugs sont uniques par espace et site. Les références vers site et profil emploient des contraintes composites de tenant. Les assignations sont validées contre les membres actifs de l’espace.

Le HTML est borné, débarrassé des attributs non autorisés et contrôlé par une liste positive. Les éléments exécutables, gestionnaires d’événements et schémas dangereux sont refusés avec `CONTENT_HTML_UNSAFE`. Le texte brut, le nombre de mots Unicode et le temps de lecture à 225 mots/minute sont recalculés côté serveur. Les journaux d’audit ne contiennent jamais le corps HTML.

## Conséquences

- Les fournisseurs de publication pourront consommer un contenu approuvé sans devenir sa source de vérité.
- L’historique est consultable et traçable, mais la Phase 3A ne propose pas de restauration automatique d’une ancienne version.
- Le verrouillage optimiste exige que tous les clients d’écriture transmettent la version chargée.
- L’archivage est logique; aucune route de suppression physique de contenu n’est exposée.
