CREATE TYPE "ContentCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TYPE "ContentReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

CREATE TYPE "ContentPublicationBindingStatus" AS ENUM ('PENDING', 'ACTIVE', 'MISSING', 'ERROR');

ALTER TABLE "content_revisions"
  ADD CONSTRAINT "content_revisions_id_workspace_id_website_id_content_item_id_key"
  UNIQUE ("id", "workspace_id", "website_id", "content_item_id");

CREATE TABLE "content_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "content_item_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "message" VARCHAR(4000) NOT NULL,
  "status" "ContentCommentStatus" NOT NULL DEFAULT 'OPEN',
  "resolved_at" TIMESTAMPTZ(3),
  "resolved_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_comments_id_workspace_id_website_id_content_item_id_key"
    UNIQUE ("id", "workspace_id", "website_id", "content_item_id"),
  CONSTRAINT "content_comments_resolution_check"
    CHECK (("status" = 'OPEN' AND "resolved_at" IS NULL AND "resolved_by_user_id" IS NULL)
      OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL)),
  CONSTRAINT "content_comments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_comments_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_comments_content_item_id_workspace_id_website_id_fkey"
    FOREIGN KEY ("content_item_id", "workspace_id", "website_id")
    REFERENCES "content_items"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_comments_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_comments_resolved_by_user_id_fkey"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "content_comments_workspace_id_website_id_content_item_id_status_created_at_idx"
  ON "content_comments" ("workspace_id", "website_id", "content_item_id", "status", "created_at");

CREATE TABLE "content_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "content_item_id" UUID NOT NULL,
  "content_revision_id" UUID NOT NULL,
  "reviewer_user_id" UUID NOT NULL,
  "decision" "ContentReviewDecision" NOT NULL,
  "note" VARCHAR(4000),
  "reviewed_revision_number" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_reviews_revision_number_check" CHECK ("reviewed_revision_number" >= 1),
  CONSTRAINT "content_reviews_changes_note_check"
    CHECK ("decision" <> 'CHANGES_REQUESTED' OR length(btrim(COALESCE("note", ''))) > 0),
  CONSTRAINT "content_reviews_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_reviews_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_reviews_content_item_id_workspace_id_website_id_fkey"
    FOREIGN KEY ("content_item_id", "workspace_id", "website_id")
    REFERENCES "content_items"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_reviews_content_revision_id_workspace_id_website_id_content_item_id_fkey"
    FOREIGN KEY ("content_revision_id", "workspace_id", "website_id", "content_item_id")
    REFERENCES "content_revisions"("id", "workspace_id", "website_id", "content_item_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_reviews_reviewer_user_id_fkey"
    FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "content_reviews_workspace_id_website_id_content_item_id_created_at_idx"
  ON "content_reviews" ("workspace_id", "website_id", "content_item_id", "created_at");
CREATE INDEX "content_reviews_reviewer_user_id_created_at_idx"
  ON "content_reviews" ("reviewer_user_id", "created_at");

CREATE TABLE "content_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "content_item_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "provider" "PublishingProviderType" NOT NULL,
  "external_site_id" VARCHAR(255) NOT NULL,
  "external_post_id" VARCHAR(255),
  "status" "ContentPublicationBindingStatus" NOT NULL DEFAULT 'PENDING',
  "last_synchronized_revision_number" INTEGER,
  "last_synchronized_hash" CHAR(64),
  "last_error_code" VARCHAR(120),
  "missing_confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_publications_id_workspace_id_website_id_key"
    UNIQUE ("id", "workspace_id", "website_id"),
  CONSTRAINT "content_publications_content_item_id_provider_external_site_id_key"
    UNIQUE ("content_item_id", "provider", "external_site_id"),
  CONSTRAINT "content_publications_revision_check"
    CHECK ("last_synchronized_revision_number" IS NULL OR "last_synchronized_revision_number" >= 1),
  CONSTRAINT "content_publications_active_external_post_check"
    CHECK ("status" <> 'ACTIVE' OR "external_post_id" IS NOT NULL),
  CONSTRAINT "content_publications_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_publications_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_publications_content_item_id_workspace_id_website_id_fkey"
    FOREIGN KEY ("content_item_id", "workspace_id", "website_id")
    REFERENCES "content_items"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_publications_connection_id_workspace_id_website_id_fkey"
    FOREIGN KEY ("connection_id", "workspace_id", "website_id")
    REFERENCES "website_connections"("id", "workspace_id", "website_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "content_publications_workspace_id_website_id_status_updated_at_idx"
  ON "content_publications" ("workspace_id", "website_id", "status", "updated_at");
CREATE INDEX "content_publications_connection_id_external_post_id_idx"
  ON "content_publications" ("connection_id", "external_post_id");

ALTER TABLE "provider_publications" ADD COLUMN "content_publication_id" UUID;

ALTER TABLE "provider_publications"
  ADD CONSTRAINT "provider_publications_content_publication_id_fkey"
  FOREIGN KEY ("content_publication_id") REFERENCES "content_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "provider_publications_content_publication_id_idempotency_key_key"
  ON "provider_publications" ("content_publication_id", "idempotency_key");
