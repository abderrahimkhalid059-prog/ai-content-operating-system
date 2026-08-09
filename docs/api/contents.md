# API de contenu — Phase 3A

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
