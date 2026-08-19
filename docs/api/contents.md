# API de contenu — Phases 3A et 3B

Toutes les routes sont sous `/api/v1/workspaces/:workspaceId/websites/:websiteId/contents`, exigent un JWT et héritent des contrôles d’appartenance à l’espace. Un identifiant provenant d’un autre espace ou site est traité comme introuvable.

| Méthode | Route                                   | Permission                | Usage                                                 |
| ------- | --------------------------------------- | ------------------------- | ----------------------------------------------------- |
| `GET`   | `/`                                     | `contents.read`           | Liste filtrée et paginée                              |
| `POST`  | `/`                                     | `contents.create`         | Création manuelle et version 1                        |
| `GET`   | `/:contentId`                           | `contents.read`           | Détail courant                                        |
| `PATCH` | `/:contentId`                           | Selon les champs          | Contenu, SEO et/ou assignation avec `expectedVersion` |
| `POST`  | `/:contentId/transition`                | `contents.transition`     | Transition d’état explicite                           |
| `POST`  | `/:contentId/archive`                   | `contents.archive`        | Archivage logique                                     |
| `GET`   | `/:contentId/revisions`                 | `contents.revisions.read` | 100 dernières versions                                |
| `GET`   | `/:contentId/revisions/:revisionNumber` | `contents.revisions.read` | Instantané immuable                                   |

La liste accepte `page`, `pageSize`, `search`, les deux statuts, `assignedTo`, `createdBy`, `language`, `contentProfileId` et les bornes ISO `createdFrom`, `createdTo`, `updatedFrom`, `updatedTo`.

## Concurrence et erreurs stables

`PATCH`, `transition` et `archive` exigent `expectedVersion`. Une écriture concurrente retourne HTTP 409 avec `CONTENT_STALE_UPDATE`. Les autres conflits métier stables sont `CONTENT_SLUG_CONFLICT`, `CONTENT_INVALID_TRANSITION`, `CONTENT_HTML_UNSAFE`, `CONTENT_ASSIGNMENT_INVALID` et `CONTENT_PROFILE_INVALID`.

## États

Le flux normal est `IDEA → RESEARCHING → OUTLINED → DRAFT → IN_REVIEW → APPROVED → READY_TO_PUBLISH → PUBLISHED`; des raccourcis documentés permettent d’entrer en brouillon et `IN_REVIEW → CHANGES_REQUESTED → DRAFT`. Tout état non archivé peut être archivé. Le statut de publication reste indépendant et vaut `NOT_PUBLISHED` en Phase 3A.

Les rôles utilisent la matrice fixe : les rédacteurs créent et modifient leurs contenus éditables, les relecteurs effectuent les décisions de relecture, les responsables SEO ne modifient que les champs SEO, et les lecteurs restent en lecture seule.

## Centre de révision

`GET /api/v1/workspaces/:workspaceId/websites/:websiteId/review-center` retourne une pagination et
les compteurs `TO_WRITE`, `IN_REVIEW`, `CHANGES_REQUESTED`, `APPROVED` et `READY_TO_PUBLISH`. Les
filtres acceptent site implicite, file/statut, langue, auteur, assigné, profil, date de modification
et recherche bornée.

| Méthode | Route                                     | Permission                          |
| ------- | ----------------------------------------- | ----------------------------------- |
| `GET`   | `/:contentId/comments`                    | `contents.comments.read`            |
| `POST`  | `/:contentId/comments`                    | `contents.comments.create`          |
| `POST`  | `/:contentId/comments/:commentId/resolve` | `contents.comments.resolve`         |
| `POST`  | `/:contentId/comments/:commentId/reopen`  | `contents.comments.resolve`         |
| `GET`   | `/:contentId/reviews`                     | `contents.reviews.read`             |
| `POST`  | `/:contentId/reviews`                     | décision `approve`/`requestChanges` |

Une décision fournit `reviewedRevisionNumber`. `CHANGES_REQUESTED` exige une note. La décision,
l’instantané de révision suivant et la transition `IN_REVIEW` sont transactionnels. Les routes de
transition génériques refusent ces deux décisions pour empêcher un contournement de l’historique.

## Handoff Blogger Draft

| Méthode | Route                                   | Permission                         |
| ------- | --------------------------------------- | ---------------------------------- |
| `GET`   | `/:contentId/publication`               | `contents.publication.read`        |
| `POST`  | `/:contentId/publication/blogger/draft` | `contents.publication.createDraft` |
| `PATCH` | `/:contentId/publication/blogger/draft` | `contents.publication.updateDraft` |

Les mutations n’acceptent que `expectedRevision` et une clé d’idempotence bornée. Le serveur exige
`READY_TO_PUBLISH`, résout la connexion/site/ID externe, transmet titre, HTML assaini et libellés au
`PublishingProvider`, puis conserve la révision synchronisée. Aucun `externalPostId` du navigateur
n’est accepté. Un rechargement reconstruit `NOT_CONNECTED`, `DRAFT_CREATED`, `OUT_OF_SYNC`,
`SYNCHRONIZED`, `ERROR` ou `MISSING` depuis PostgreSQL et une lecture provider authentifiée.

Ce flux ne fournit aucun endpoint de publication publique ou suppression. Un brouillon manquant
confirmé n’est jamais recréé automatiquement.
