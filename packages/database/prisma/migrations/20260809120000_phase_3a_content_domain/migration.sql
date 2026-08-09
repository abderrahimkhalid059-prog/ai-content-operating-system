CREATE TYPE "ContentEditorialStatus" AS ENUM (
  'IDEA',
  'RESEARCHING',
  'OUTLINED',
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'READY_TO_PUBLISH',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE "ContentPublicationStatus" AS ENUM (
  'NOT_PUBLISHED',
  'DRAFT_SENT',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED'
);

ALTER TABLE "content_profiles"
  ADD CONSTRAINT "content_profiles_id_workspace_id_website_id_key"
  UNIQUE ("id", "workspace_id", "website_id");

CREATE TABLE "content_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "content_profile_id" UUID,
  "title" VARCHAR(300) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "excerpt" VARCHAR(1000),
  "html_content" TEXT NOT NULL,
  "plain_text_content" TEXT NOT NULL,
  "meta_title" VARCHAR(70),
  "meta_description" VARCHAR(180),
  "canonical_url" VARCHAR(1500),
  "language" VARCHAR(10) NOT NULL,
  "locale" VARCHAR(35),
  "featured_image_reference" VARCHAR(1000),
  "labels" JSONB NOT NULL,
  "word_count" INTEGER NOT NULL,
  "estimated_reading_minutes" INTEGER NOT NULL,
  "editorial_status" "ContentEditorialStatus" NOT NULL DEFAULT 'IDEA',
  "publication_status" "ContentPublicationStatus" NOT NULL DEFAULT 'NOT_PUBLISHED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "assigned_to_user_id" UUID,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_items_workspace_id_website_id_slug_key"
    UNIQUE ("workspace_id", "website_id", "slug"),
  CONSTRAINT "content_items_id_workspace_id_website_id_key"
    UNIQUE ("id", "workspace_id", "website_id"),
  CONSTRAINT "content_items_metrics_check"
    CHECK ("word_count" >= 0 AND "estimated_reading_minutes" >= 0 AND "version" >= 1),
  CONSTRAINT "content_items_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_items_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_items_content_profile_id_workspace_id_website_id_fkey"
    FOREIGN KEY ("content_profile_id", "workspace_id", "website_id")
    REFERENCES "content_profiles"("id", "workspace_id", "website_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_items_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "content_items_assigned_to_user_id_fkey"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "content_items_workspace_id_website_id_editorial_status_updated_at_idx"
  ON "content_items" ("workspace_id", "website_id", "editorial_status", "updated_at");
CREATE INDEX "content_items_workspace_id_website_id_publication_status_updated_at_idx"
  ON "content_items" ("workspace_id", "website_id", "publication_status", "updated_at");
CREATE INDEX "content_items_workspace_id_website_id_assigned_to_user_id_idx"
  ON "content_items" ("workspace_id", "website_id", "assigned_to_user_id");
CREATE INDEX "content_items_workspace_id_website_id_created_by_user_id_idx"
  ON "content_items" ("workspace_id", "website_id", "created_by_user_id");
CREATE INDEX "content_items_workspace_id_website_id_content_profile_id_idx"
  ON "content_items" ("workspace_id", "website_id", "content_profile_id");

CREATE TABLE "content_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "content_item_id" UUID NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "excerpt" VARCHAR(1000),
  "html_content" TEXT NOT NULL,
  "plain_text_content" TEXT NOT NULL,
  "meta_title" VARCHAR(70),
  "meta_description" VARCHAR(180),
  "canonical_url" VARCHAR(1500),
  "language" VARCHAR(10) NOT NULL,
  "locale" VARCHAR(35),
  "featured_image_reference" VARCHAR(1000),
  "labels" JSONB NOT NULL,
  "word_count" INTEGER NOT NULL,
  "estimated_reading_minutes" INTEGER NOT NULL,
  "editorial_status" "ContentEditorialStatus" NOT NULL,
  "publication_status" "ContentPublicationStatus" NOT NULL,
  "assigned_to_user_id" UUID,
  "content_profile_id" UUID,
  "changed_by_user_id" UUID NOT NULL,
  "change_reason" VARCHAR(500),
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_revisions_content_item_id_revision_number_key"
    UNIQUE ("content_item_id", "revision_number"),
  CONSTRAINT "content_revisions_revision_number_check" CHECK ("revision_number" >= 1),
  CONSTRAINT "content_revisions_content_item_id_workspace_id_website_id_fkey"
    FOREIGN KEY ("content_item_id", "workspace_id", "website_id")
    REFERENCES "content_items"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_revisions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_revisions_website_id_workspace_id_fkey"
    FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_revisions_changed_by_user_id_fkey"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "content_revisions_workspace_id_website_id_content_item_id_revision_number_idx"
  ON "content_revisions" ("workspace_id", "website_id", "content_item_id", "revision_number");
