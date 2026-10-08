CREATE TYPE "AiGenerationCandidateStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'APPLIED', 'DISCARDED');
CREATE TYPE "ContentRevisionOrigin" AS ENUM ('MANUAL', 'AI_GENERATED');

CREATE TABLE "ai_generation_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "content_profile_id" UUID NOT NULL,
    "ai_run_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "applied_by_user_id" UUID,
    "status" "AiGenerationCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(160) NOT NULL,
    "base_revision_number" INTEGER NOT NULL,
    "prompt_identifier" VARCHAR(120) NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "title" VARCHAR(300),
    "excerpt" VARCHAR(1000),
    "html_content" TEXT,
    "suggested_slug" VARCHAR(120),
    "meta_description" VARCHAR(180),
    "suggested_labels" JSONB,
    "warnings" JSONB,
    "error_code" VARCHAR(120),
    "applied_revision_number" INTEGER,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_generation_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_generation_candidates_state_consistency" CHECK (
      ("status" = 'PENDING' AND "title" IS NULL AND "html_content" IS NULL)
      OR ("status" IN ('READY', 'APPLIED') AND "title" IS NOT NULL AND "html_content" IS NOT NULL AND "ai_run_id" IS NOT NULL)
      OR ("status" = 'FAILED' AND "error_code" IS NOT NULL)
      OR ("status" = 'DISCARDED' AND (("title" IS NULL AND "html_content" IS NULL) OR ("title" IS NOT NULL AND "html_content" IS NOT NULL AND "ai_run_id" IS NOT NULL)))
    ),
    CONSTRAINT "ai_generation_candidates_apply_consistency" CHECK (
      ("status" = 'APPLIED' AND "applied_by_user_id" IS NOT NULL AND "applied_at" IS NOT NULL AND "applied_revision_number" IS NOT NULL)
      OR ("status" <> 'APPLIED' AND "applied_by_user_id" IS NULL AND "applied_at" IS NULL AND "applied_revision_number" IS NULL)
    )
);

ALTER TABLE "content_revisions"
  ADD COLUMN "origin" "ContentRevisionOrigin" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "ai_run_id" UUID,
  ADD COLUMN "ai_generation_candidate_id" UUID,
  ADD COLUMN "base_revision_number" INTEGER;

CREATE UNIQUE INDEX "ai_generation_candidates_ai_run_id_key" ON "ai_generation_candidates"("ai_run_id");
CREATE UNIQUE INDEX "ai_generation_candidates_id_workspace_website_content_key" ON "ai_generation_candidates"("id", "workspace_id", "website_id", "content_item_id");
CREATE UNIQUE INDEX "ai_generation_candidates_workspace_id_idempotency_key_key" ON "ai_generation_candidates"("workspace_id", "idempotency_key");
CREATE INDEX "ai_generation_candidates_content_status_created_idx" ON "ai_generation_candidates"("workspace_id", "website_id", "content_item_id", "status", "created_at");
CREATE INDEX "ai_generation_candidates_created_by_created_idx" ON "ai_generation_candidates"("created_by_user_id", "created_at");
CREATE UNIQUE INDEX "content_revisions_ai_generation_candidate_id_key" ON "content_revisions"("ai_generation_candidate_id");
CREATE UNIQUE INDEX "content_revisions_ai_candidate_scope_key" ON "content_revisions"("ai_generation_candidate_id", "workspace_id", "website_id", "content_item_id");
CREATE INDEX "content_revisions_ai_run_id_idx" ON "content_revisions"("ai_run_id");
CREATE UNIQUE INDEX "ai_runs_id_workspace_id_key" ON "ai_runs"("id", "workspace_id");
CREATE UNIQUE INDEX "ai_generation_candidates_ai_run_workspace_key" ON "ai_generation_candidates"("ai_run_id", "workspace_id");

ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_website_workspace_fkey" FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_content_item_scope_fkey" FOREIGN KEY ("content_item_id", "workspace_id", "website_id") REFERENCES "content_items"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_content_profile_scope_fkey" FOREIGN KEY ("content_profile_id", "workspace_id", "website_id") REFERENCES "content_profiles"("id", "workspace_id", "website_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_ai_run_workspace_fkey" FOREIGN KEY ("ai_run_id", "workspace_id") REFERENCES "ai_runs"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_generation_candidates" ADD CONSTRAINT "ai_generation_candidates_applied_by_fkey" FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_ai_run_workspace_fkey" FOREIGN KEY ("ai_run_id", "workspace_id") REFERENCES "ai_runs"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_ai_candidate_scope_fkey" FOREIGN KEY ("ai_generation_candidate_id", "workspace_id", "website_id", "content_item_id") REFERENCES "ai_generation_candidates"("id", "workspace_id", "website_id", "content_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_ai_provenance_consistency" CHECK (
  ("origin" = 'MANUAL' AND "ai_run_id" IS NULL AND "ai_generation_candidate_id" IS NULL AND "base_revision_number" IS NULL)
  OR ("origin" = 'AI_GENERATED' AND "ai_run_id" IS NOT NULL AND "ai_generation_candidate_id" IS NOT NULL AND "base_revision_number" IS NOT NULL)
);
