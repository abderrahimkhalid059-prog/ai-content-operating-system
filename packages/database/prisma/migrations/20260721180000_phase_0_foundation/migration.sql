CREATE TYPE "WebsitePlatform" AS ENUM ('BLOGGER', 'WORDPRESS', 'OTHER');
CREATE TYPE "WebsiteStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "JobRecordStatus" AS ENUM ('WAITING', 'ACTIVE', 'COMPLETED', 'FAILED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "websites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "platform" "WebsitePlatform" NOT NULL,
  "language" VARCHAR(10) NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "status" "WebsiteStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID,
  "key" VARCHAR(120) NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID,
  "website_id" UUID,
  "user_id" UUID,
  "action" VARCHAR(120) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_job_id" VARCHAR(100) NOT NULL,
  "queue" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "status" "JobRecordStatus" NOT NULL DEFAULT 'WAITING',
  "correlation_id" UUID NOT NULL,
  "workspace_id" UUID,
  "website_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "job_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");
CREATE UNIQUE INDEX "workspace_members_user_id_workspace_id_key" ON "workspace_members"("user_id", "workspace_id");
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");
CREATE UNIQUE INDEX "websites_workspace_id_slug_key" ON "websites"("workspace_id", "slug");
CREATE INDEX "websites_workspace_id_status_idx" ON "websites"("workspace_id", "status");
CREATE UNIQUE INDEX "system_settings_workspace_id_key_key" ON "system_settings"("workspace_id", "key");
CREATE INDEX "system_settings_key_idx" ON "system_settings"("key");
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");
CREATE INDEX "audit_logs_website_id_created_at_idx" ON "audit_logs"("website_id", "created_at");
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
CREATE UNIQUE INDEX "job_records_queue_external_job_id_key" ON "job_records"("queue", "external_job_id");
CREATE INDEX "job_records_correlation_id_idx" ON "job_records"("correlation_id");
CREATE INDEX "job_records_workspace_id_status_idx" ON "job_records"("workspace_id", "status");
CREATE INDEX "job_records_website_id_status_idx" ON "job_records"("website_id", "status");

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "websites" ADD CONSTRAINT "websites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_records" ADD CONSTRAINT "job_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_records" ADD CONSTRAINT "job_records_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "websites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
