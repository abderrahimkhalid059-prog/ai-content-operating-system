# ADR-007: Fixed workspace RBAC

## Status

Accepted for Phase 1.

## Decision

Roles are fixed: `OWNER`, `ADMIN`, `EDITOR`, `REVIEWER`, `SEO_MANAGER`, `WRITER`, and `VIEWER`. The backend permission map is authoritative.

| Permission                                        | Owner | Admin | Editor | Reviewer | SEO Manager | Writer | Viewer |
| ------------------------------------------------- | :---: | :---: | :----: | :------: | :---------: | :----: | :----: |
| workspace.read/update                             |   ✓   |   ✓   |  read  |   read   |    read     |  read  |  read  |
| workspace.deactivate                              |   ✓   |   —   |   —    |    —     |      —      |   —    |   —    |
| members.read                                      |   ✓   |   ✓   |   ✓    |    ✓     |      ✓      |   ✓    |   ✓    |
| members.create/update/delete                      |   ✓   |   ✓   |   —    |    —     |      —      |   —    |   —    |
| users.read/create/update/deactivate/resetPassword |   ✓   |   ✓   |   —    |    —     |      —      |   —    |   —    |
| websites.read                                     |   ✓   |   ✓   |   ✓    |    ✓     |      ✓      |   ✓    |   ✓    |
| websites.create/update/delete                     |   ✓   |   ✓   |   ✓    |    —     |      —      |   —    |   —    |
| contentProfiles.read                              |   ✓   |   ✓   |   ✓    |    ✓     |      ✓      |   ✓    |   ✓    |
| contentProfiles.create/update/delete              |   ✓   |   ✓   |   ✓    |    —     |      —      |   —    |   —    |
| audit.read                                        |   ✓   |   ✓   |   —    |    —     |      —      |   —    |   —    |

Admins cannot assign, demote, or remove Owners and cannot deactivate a workspace. Owner transitions use serializable transactions and count active Owners. The final active Owner cannot be removed, demoted, or deactivated. Users may not use a self-role change to bypass those rules.

## Consequences

The model is predictable and testable. Custom roles and content-workflow permissions remain deferred until their actual domain exists.
