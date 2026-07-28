# Blogger Live validation checklist

Phase 2 implements the Live adapter but has **not** validated a real Google account or Blogger blog.
Perform this checklist later as a separately authorized Phase 2B activity.

1. Create or select a Google Cloud project and enable Blogger API v3.
2. Configure the OAuth consent screen and create an OAuth Web Client.
3. Add the exact redirect URI, locally:
   `http://localhost:3000/api/v1/integrations/blogger/callback`.
4. Store client ID, client secret and a generated 32-byte encryption key only in the ignored local
   `.env`. Never use a `VITE_` variable for them.
5. Set `BLOGGER_MODE=live`, `BLOGGER_ALLOW_PUBLIC_PUBLISH=false` and
   `BLOGGER_ALLOW_DELETE=false`.
6. Start the stack, connect a Blogger account, list blogs and select an expressly approved test blog.
7. Run a read-only sync; verify blog metadata, imported posts, timestamps and labels.
8. Create one clearly named **unpublished** test draft, read it back and update it.
9. Keep public publishing disabled until separately approved.
10. If removal is approved, temporarily enable delete, restart, remove only the named test draft,
    then disable delete again.
11. Inspect audit logs for connect, selection, sync and mutations; confirm no credential is present.
12. Disconnect/revoke the test credentials when required.

Record Google-side errors and request IDs without copying tokens or raw sensitive responses.
