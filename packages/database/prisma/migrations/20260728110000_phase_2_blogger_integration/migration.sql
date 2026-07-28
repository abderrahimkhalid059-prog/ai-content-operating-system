CREATE TYPE "PublishingProviderType" AS ENUM ('BLOGGER', 'WORDPRESS', 'OTHER');
CREATE TYPE "IntegrationMode" AS ENUM ('MOCK', 'LIVE');
CREATE TYPE "WebsiteConnectionStatus" AS ENUM (
  'PENDING',
  'CONNECTED',
  'DEGRADED',
  'EXPIRED',
  'REVOKED',
  'DISCONNECTED'
);
CREATE TYPE "ExternalPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'DELETED');
CREATE TYPE "ExternalTaxonomyType" AS ENUM ('LABEL');
CREATE TYPE "IntegrationSyncType" AS ENUM ('FULL', 'POSTS', 'LABELS', 'TEST');
CREATE TYPE "IntegrationSyncStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "ProviderPublicationOperation" AS ENUM (
  'CREATE_DRAFT',
  'UPDATE_POST',
  'PUBLISH_POST',
  'DELETE_POST'
);
CREATE TYPE "ProviderPublicationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "website_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "provider" "PublishingProviderType" NOT NULL,
  "mode" "IntegrationMode" NOT NULL,
  "status" "WebsiteConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "external_account_id" VARCHAR(255),
  "external_site_id" VARCHAR(255),
  "external_site_name" VARCHAR(255),
  "external_site_url" VARCHAR(1000),
  "encrypted_credentials" TEXT,
  "credential_key_version" VARCHAR(50),
  "granted_scopes" JSONB,
  "connected_by_user_id" UUID NOT NULL,
  "connected_at" TIMESTAMPTZ(3),
  "last_tested_at" TIMESTAMPTZ(3),
  "last_successful_sync_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(120),
  "last_error_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "website_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "website_connections_id_workspace_id_website_id_key"
    UNIQUE ("id", "workspace_id", "website_id"),
  CONSTRAINT "website_connections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "website_connections_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "website_connections_connected_by_user_id_fkey"
    FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "website_connections_one_active_blogger_idx"
  ON "website_connections" ("website_id", "provider")
  WHERE "revoked_at" IS NULL
    AND "status" IN ('PENDING', 'CONNECTED', 'DEGRADED', 'EXPIRED');
CREATE INDEX "website_connections_workspace_id_status_idx"
  ON "website_connections" ("workspace_id", "status");
CREATE INDEX "website_connections_website_id_provider_status_idx"
  ON "website_connections" ("website_id", "provider", "status");
CREATE INDEX "website_connections_provider_external_site_id_idx"
  ON "website_connections" ("provider", "external_site_id");

CREATE TABLE "oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" "PublishingProviderType" NOT NULL,
  "mode" "IntegrationMode" NOT NULL,
  "state_hash" CHAR(64) NOT NULL,
  "code_verifier_hash" CHAR(64),
  "redirect_after" VARCHAR(500) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oauth_states_state_hash_key" UNIQUE ("state_hash"),
  CONSTRAINT "oauth_states_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "oauth_states_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "oauth_states_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "oauth_states_workspace_id_website_id_provider_idx"
  ON "oauth_states" ("workspace_id", "website_id", "provider");
CREATE INDEX "oauth_states_expires_at_consumed_at_idx"
  ON "oauth_states" ("expires_at", "consumed_at");

CREATE TABLE "external_posts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "provider" "PublishingProviderType" NOT NULL,
  "external_post_id" VARCHAR(255) NOT NULL,
  "external_blog_id" VARCHAR(255) NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "slug_or_url" VARCHAR(1500),
  "status" "ExternalPostStatus" NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "labels" JSONB NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "updated_externally_at" TIMESTAMPTZ(3),
  "last_imported_at" TIMESTAMPTZ(3) NOT NULL,
  "raw_metadata" JSONB,
  "deleted_externally_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_posts_connection_id_provider_external_post_id_key"
    UNIQUE ("connection_id", "provider", "external_post_id"),
  CONSTRAINT "external_posts_connection_scope_fkey"
    FOREIGN KEY ("connection_id", "workspace_id", "website_id")
    REFERENCES "website_connections"("id", "workspace_id", "website_id") ON DELETE CASCADE
);
CREATE INDEX "external_posts_workspace_id_website_id_status_idx"
  ON "external_posts" ("workspace_id", "website_id", "status");
CREATE INDEX "external_posts_connection_id_last_imported_at_idx"
  ON "external_posts" ("connection_id", "last_imported_at");

CREATE TABLE "external_taxonomy_terms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "provider" "PublishingProviderType" NOT NULL,
  "type" "ExternalTaxonomyType" NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "normalized_name" VARCHAR(255) NOT NULL,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_taxonomy_terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_taxonomy_terms_connection_provider_type_name_key"
    UNIQUE ("connection_id", "provider", "type", "normalized_name"),
  CONSTRAINT "external_taxonomy_terms_connection_scope_fkey"
    FOREIGN KEY ("connection_id", "workspace_id", "website_id")
    REFERENCES "website_connections"("id", "workspace_id", "website_id") ON DELETE CASCADE
);
CREATE INDEX "external_taxonomy_terms_workspace_website_type_idx"
  ON "external_taxonomy_terms" ("workspace_id", "website_id", "type");

CREATE TABLE "integration_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "type" "IntegrationSyncType" NOT NULL DEFAULT 'FULL',
  "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'PENDING',
  "correlation_id" UUID NOT NULL,
  "external_job_id" VARCHAR(120),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "cursor" VARCHAR(500),
  "items_processed" INTEGER NOT NULL DEFAULT 0,
  "items_created" INTEGER NOT NULL DEFAULT 0,
  "items_updated" INTEGER NOT NULL DEFAULT 0,
  "items_failed" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(120),
  "safe_error_message" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_sync_runs_correlation_id_key" UNIQUE ("correlation_id"),
  CONSTRAINT "integration_sync_runs_connection_scope_fkey"
    FOREIGN KEY ("connection_id", "workspace_id", "website_id")
    REFERENCES "website_connections"("id", "workspace_id", "website_id") ON DELETE CASCADE
);
CREATE INDEX "integration_sync_runs_workspace_website_created_idx"
  ON "integration_sync_runs" ("workspace_id", "website_id", "created_at");
CREATE INDEX "integration_sync_runs_connection_status_idx"
  ON "integration_sync_runs" ("connection_id", "status");
CREATE UNIQUE INDEX "integration_sync_runs_one_active_idx"
  ON "integration_sync_runs" ("connection_id")
  WHERE "status" IN ('PENDING', 'RUNNING');

CREATE TABLE "provider_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "provider" "PublishingProviderType" NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "operation_type" "ProviderPublicationOperation" NOT NULL,
  "external_post_id" VARCHAR(255),
  "request_hash" CHAR(64) NOT NULL,
  "status" "ProviderPublicationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "safe_error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_publications_connection_provider_idempotency_key"
    UNIQUE ("connection_id", "provider", "idempotency_key"),
  CONSTRAINT "provider_publications_connection_scope_fkey"
    FOREIGN KEY ("connection_id", "workspace_id", "website_id")
    REFERENCES "website_connections"("id", "workspace_id", "website_id") ON DELETE CASCADE
);
CREATE INDEX "provider_publications_workspace_website_status_idx"
  ON "provider_publications" ("workspace_id", "website_id", "status");
CREATE INDEX "provider_publications_connection_external_post_idx"
  ON "provider_publications" ("connection_id", "external_post_id");

-- Align Prisma-managed constraint/index names and @updatedAt columns while retaining
-- the two deliberate partial unique indexes above.
ALTER TABLE "external_posts"
  DROP CONSTRAINT "external_posts_connection_scope_fkey",
  ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "external_taxonomy_terms"
  DROP CONSTRAINT "external_taxonomy_terms_connection_scope_fkey",
  ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "integration_sync_runs"
  DROP CONSTRAINT "integration_sync_runs_connection_scope_fkey",
  ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "provider_publications"
  DROP CONSTRAINT "provider_publications_connection_scope_fkey",
  ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "website_connections"
  ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "external_posts"
  ADD CONSTRAINT "external_posts_connection_id_workspace_id_website_id_fkey"
  FOREIGN KEY ("connection_id", "workspace_id", "website_id")
  REFERENCES "website_connections"("id", "workspace_id", "website_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_taxonomy_terms"
  ADD CONSTRAINT "external_taxonomy_terms_connection_id_workspace_id_website_fkey"
  FOREIGN KEY ("connection_id", "workspace_id", "website_id")
  REFERENCES "website_connections"("id", "workspace_id", "website_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_sync_runs"
  ADD CONSTRAINT "integration_sync_runs_connection_id_workspace_id_website_i_fkey"
  FOREIGN KEY ("connection_id", "workspace_id", "website_id")
  REFERENCES "website_connections"("id", "workspace_id", "website_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_publications"
  ADD CONSTRAINT "provider_publications_connection_id_workspace_id_website_i_fkey"
  FOREIGN KEY ("connection_id", "workspace_id", "website_id")
  REFERENCES "website_connections"("id", "workspace_id", "website_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER INDEX "external_taxonomy_terms_connection_provider_type_name_key"
  RENAME TO "external_taxonomy_terms_connection_id_provider_type_normali_key";
ALTER INDEX "external_taxonomy_terms_workspace_website_type_idx"
  RENAME TO "external_taxonomy_terms_workspace_id_website_id_type_idx";
ALTER INDEX "integration_sync_runs_connection_status_idx"
  RENAME TO "integration_sync_runs_connection_id_status_idx";
ALTER INDEX "integration_sync_runs_workspace_website_created_idx"
  RENAME TO "integration_sync_runs_workspace_id_website_id_created_at_idx";
ALTER INDEX "provider_publications_connection_external_post_idx"
  RENAME TO "provider_publications_connection_id_external_post_id_idx";
ALTER INDEX "provider_publications_connection_provider_idempotency_key"
  RENAME TO "provider_publications_connection_id_provider_idempotency_ke_key";
ALTER INDEX "provider_publications_workspace_website_status_idx"
  RENAME TO "provider_publications_workspace_id_website_id_status_idx";
