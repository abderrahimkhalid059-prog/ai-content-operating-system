# API d’infrastructure IA — Phase 4A

Toutes les routes sont authentifiées, préfixées par
`/api/v1/workspaces/:workspaceId/ai` et protégées par le contexte d’espace.

| Méthode | Route                      | Permission         | Objet                                                        |
| ------- | -------------------------- | ------------------ | ------------------------------------------------------------ |
| GET     | `/providers`               | `ai.config.read`   | Adaptateurs enregistrés et capacités publiques               |
| GET     | `/configurations`          | `ai.config.read`   | Configurations masquées de l’espace                          |
| PUT     | `/configurations`          | `ai.config.update` | Upsert idempotent par portée                                 |
| GET     | `/resolved-configuration`  | `ai.config.read`   | Résolution avec `websiteId` et `contentProfileId` optionnels |
| POST    | `/configurations/:id/test` | `ai.config.test`   | Sonde d’infrastructure sans contenu métier                   |
| GET     | `/runs`                    | `ai.runs.read`     | Métadonnées des exécutions récentes                          |

## Portées et priorité

La résolution est déterministe : `CONTENT_PROFILE`, puis `WEBSITE`, puis `WORKSPACE`, puis le
défaut système sûr `mock/mock-v1`. Une configuration désactivée est ignorée. Un profil ne peut
être fourni qu’avec son site et les relations composites empêchent tout mélange d’espace/site.

## Identifiants et confidentialité

Le champ `credential` est strictement en écriture. Il est chiffré avec l’enveloppe AES-256-GCM et
la version de clé déjà utilisées par les intégrations. Les réponses contiennent seulement
`hasCredential` et une indication des quatre derniers caractères. Le remplacement ou la
suppression sont audités comme des booléens, sans valeur secrète.

Les exécutions ne stockent ni prompt rendu, ni réponse, ni contenu client. Elles conservent le
fournisseur, le modèle, l’identifiant/version du prompt, la corrélation, les durées, les tentatives,
l’usage déclaré et l’erreur normalisée.

## Coûts et limites

Les tarifs sont optionnels et configurables par ligne (devise et coûts d’entrée/sortie par million
de jetons, exprimés en micro-unités monétaires). Aucun tarif fournisseur n’est codé dans le domaine.
Une estimation est écrite uniquement lorsque le fournisseur retourne les deux compteurs et que la
tarification est complète. `monthlyTokenLimit` constitue un garde-fou d’usage, pas une fonction de
facturation.

## Limite de phase

La sonde `CONFIGURATION_TEST` utilise le prompt interne versionné
`infrastructure.configuration-probe@1`. Elle ne crée, ne réécrit et ne publie aucun contenu.
