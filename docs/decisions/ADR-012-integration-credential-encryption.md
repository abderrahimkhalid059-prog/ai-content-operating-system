# ADR-012 — Integration credential encryption

## Status

Accepted for Phase 2.

## Decision

Live OAuth credentials are encrypted in the application with AES-256-GCM before PostgreSQL.
Every envelope has a random 96-bit IV, authentication tag, algorithm marker and key version.
Decryption occurs only in backend connection/provider composition. Key mismatch, tampering or
missing key fails closed.

The base64-encoded 32-byte key is supplied through `INTEGRATION_ENCRYPTION_KEY`; the envelope stores
`INTEGRATION_ENCRYPTION_KEY_VERSION`. Logs redact keys, client secrets and credential fields.
Mock connections persist no token.

Generate a local key without committing it:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## Consequences

Key rotation can decrypt with the stored version and re-encrypt under a new version in a future
maintenance operation. Losing a key makes affected credentials unrecoverable and requires reconnect.
