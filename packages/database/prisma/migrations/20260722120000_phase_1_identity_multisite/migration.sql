CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ContentProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE');

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(email)
    FROM users
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 1 migration cannot normalize duplicate user email addresses';
  END IF;
END $$;

UPDATE "users" SET "email" = lower(trim("email"));

ALTER TABLE "users"
  ADD COLUMN "password_hash" VARCHAR(255) NOT NULL DEFAULT '!MIGRATED_USER_REQUIRES_ADMIN_RESET!',
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "security_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3),
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(3);

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP DEFAULT;

CREATE TYPE "WorkspaceRole_phase1" AS ENUM (
  'OWNER',
  'ADMIN',
  'EDITOR',
  'REVIEWER',
  'SEO_MANAGER',
  'WRITER',
  'VIEWER'
);

ALTER TABLE "workspace_members" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "workspace_members"
  ALTER COLUMN "role" TYPE "WorkspaceRole_phase1"
  USING (
    CASE
      WHEN "role"::text = 'MEMBER' THEN 'VIEWER'
      ELSE "role"::text
    END
  )::"WorkspaceRole_phase1";
DROP TYPE "WorkspaceRole";
ALTER TYPE "WorkspaceRole_phase1" RENAME TO "WorkspaceRole";
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

ALTER TABLE "workspaces"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deactivated_at" TIMESTAMPTZ(3);

ALTER TABLE "websites"
  ADD COLUMN "locale" VARCHAR(35),
  ADD COLUMN "description" VARCHAR(1000),
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "websites_id_workspace_id_key" ON "websites"("id", "workspace_id");

ALTER TABLE "audit_logs"
  ADD COLUMN "target_type" VARCHAR(80),
  ADD COLUMN "target_id" UUID,
  ADD COLUMN "request_id" VARCHAR(128),
  ADD COLUMN "correlation_id" VARCHAR(128),
  ADD COLUMN "ip_address" VARCHAR(64),
  ADD COLUMN "user_agent" VARCHAR(512);

CREATE INDEX "audit_logs_target_type_target_id_created_at_idx"
  ON "audit_logs"("target_type", "target_id", "created_at");

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "family_id" UUID NOT NULL,
  "user_agent" VARCHAR(512),
  "ip_address" VARCHAR(64),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "content_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "language" VARCHAR(10) NOT NULL,
  "locale" VARCHAR(35),
  "country_code" CHAR(2),
  "tone" VARCHAR(300) NOT NULL,
  "target_audience" VARCHAR(500),
  "editorial_rules" JSONB NOT NULL,
  "prohibited_topics" JSONB,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "status" "ContentProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "content_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_profiles_workspace_id_website_id_status_idx"
  ON "content_profiles"("workspace_id", "website_id", "status");
CREATE UNIQUE INDEX "content_profiles_website_id_name_key"
  ON "content_profiles"("website_id", "name");
CREATE INDEX "content_profiles_website_id_is_default_status_idx"
  ON "content_profiles"("website_id", "is_default", "status");
CREATE UNIQUE INDEX "content_profiles_one_active_default_idx"
  ON "content_profiles"("website_id")
  WHERE "is_default" = true AND "status" = 'ACTIVE';

ALTER TABLE "content_profiles"
  ADD CONSTRAINT "content_profiles_website_id_workspace_id_fkey"
  FOREIGN KEY ("website_id", "workspace_id")
  REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
