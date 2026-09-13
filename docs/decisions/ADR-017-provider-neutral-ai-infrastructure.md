# ADR-017 — Infrastructure IA neutre et sans contenu en Phase 4A

## Statut

Accepté pour Phase 4A.

## Décision

Les fournisseurs IA implémentent `AiProvider` derrière `AiProviderRegistry`. Les appels utilisent
des messages, paramètres, formats de sortie, signaux d’annulation, résultats d’usage et erreurs
normalisés. Le fournisseur mock déterministe, sans réseau, est le seul adaptateur livré en 4A.

Les configurations sont persistées à trois portées avec priorité profil → site → espace → système.
Les identifiants éventuels réutilisent `CredentialEncryption`; le navigateur ne peut jamais les
relire. `AiRun` est une piste d’observabilité minimisée qui exclut prompts et réponses bruts.

Les prompts sont enregistrés par identifiant et version, puis rendus avec validation stricte de
toutes les variables. Les sorties JSON franchissent une frontière parse/validation avant toute
acceptation. Les erreurs déterminent explicitement si une nouvelle tentative bornée est permise.

## Exécution asynchrone future

Phase 4B pourra placer une commande métier dans BullMQ, puis résoudre la configuration et appeler
le même exécuteur neutre depuis le worker. Aucun job de génération n’est ajouté maintenant : la
seule opération 4A est une sonde d’administration courte et synchrone. Ce choix évite une file sans
cas métier tout en conservant le runtime partageable dans `packages/integrations`.

## Conséquences et limites

Il n’existe aucun SDK vendeur, aucune génération d’article, recherche, réécriture, planification ou
publication automatique en 4A. Les sorties restent non fiables par principe. La tarification est
configurable et facultative; elle n’est ni une facture ni une source comptable.
