CREATE TYPE "AiConfigurationScope" AS ENUM ('WORKSPACE', 'WEBSITE', 'CONTENT_PROFILE');
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiErrorCategory" AS ENUM ('AUTHENTICATION', 'RATE_LIMIT', 'INVALID_REQUEST', 'TIMEOUT', 'UNAVAILABLE', 'MALFORMED_RESPONSE', 'UNKNOWN');

CREATE TABLE "ai_configurations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "website_id" UUID,
    "content_profile_id" UUID,
    "scope" "AiConfigurationScope" NOT NULL,
    "scope_key" UUID NOT NULL,
    "provider_key" VARCHAR(80) NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "encrypted_credentials" TEXT,
    "credential_key_version" VARCHAR(50),
    "credential_hint" VARCHAR(32),
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "temperature" REAL,
    "max_output_tokens" INTEGER,
    "monthly_token_limit" INTEGER,
    "pricing_currency" CHAR(3),
    "input_cost_per_million_micros" INTEGER,
    "output_cost_per_million_micros" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_configurations_scope_consistency" CHECK (
      ("scope" = 'WORKSPACE' AND "scope_key" = "workspace_id" AND "website_id" IS NULL AND "content_profile_id" IS NULL)
      OR ("scope" = 'WEBSITE' AND "scope_key" = "website_id" AND "website_id" IS NOT NULL AND "content_profile_id" IS NULL)
      OR ("scope" = 'CONTENT_PROFILE' AND "scope_key" = "content_profile_id" AND "website_id" IS NOT NULL AND "content_profile_id" IS NOT NULL)
    ),
    CONSTRAINT "ai_configurations_execution_bounds" CHECK ("timeout_ms" BETWEEN 50 AND 120000 AND "max_retries" BETWEEN 0 AND 5),
    CONSTRAINT "ai_configurations_generation_bounds" CHECK (("temperature" IS NULL OR "temperature" BETWEEN 0 AND 2) AND ("max_output_tokens" IS NULL OR "max_output_tokens" BETWEEN 1 AND 100000)),
    CONSTRAINT "ai_configurations_limit_bounds" CHECK ("monthly_token_limit" IS NULL OR "monthly_token_limit" >= 0),
    CONSTRAINT "ai_configurations_pricing_complete" CHECK (
      ("pricing_currency" IS NULL AND "input_cost_per_million_micros" IS NULL AND "output_cost_per_million_micros" IS NULL)
      OR ("pricing_currency" IS NOT NULL AND "input_cost_per_million_micros" IS NOT NULL AND "input_cost_per_million_micros" >= 0 AND "output_cost_per_million_micros" IS NOT NULL AND "output_cost_per_million_micros" >= 0)
    )
);

CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "website_id" UUID,
    "content_profile_id" UUID,
    "configuration_id" UUID,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "provider_key" VARCHAR(80) NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "operation" VARCHAR(120) NOT NULL,
    "prompt_identifier" VARCHAR(120) NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "latency_ms" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost_micros" INTEGER,
    "cost_currency" CHAR(3),
    "error_category" "AiErrorCategory",
    "error_code" VARCHAR(120),
    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_runs_scope_consistency" CHECK (("content_profile_id" IS NULL) OR ("website_id" IS NOT NULL)),
    CONSTRAINT "ai_runs_usage_nonnegative" CHECK (
      ("retry_count" >= 0) AND
      ("input_tokens" IS NULL OR "input_tokens" >= 0) AND
      ("output_tokens" IS NULL OR "output_tokens" >= 0) AND
      ("total_tokens" IS NULL OR "total_tokens" >= 0) AND
      ("estimated_cost_micros" IS NULL OR "estimated_cost_micros" >= 0)
    )
);

CREATE UNIQUE INDEX "ai_configurations_id_workspace_id_key" ON "ai_configurations"("id", "workspace_id");
CREATE UNIQUE INDEX "ai_configurations_workspace_id_scope_scope_key_key" ON "ai_configurations"("workspace_id", "scope", "scope_key");
CREATE INDEX "ai_configurations_workspace_id_website_id_content_profile_id_idx" ON "ai_configurations"("workspace_id", "website_id", "content_profile_id", "is_enabled");
CREATE UNIQUE INDEX "ai_runs_workspace_id_idempotency_key_key" ON "ai_runs"("workspace_id", "idempotency_key");
CREATE INDEX "ai_runs_workspace_id_started_at_idx" ON "ai_runs"("workspace_id", "started_at");
CREATE INDEX "ai_runs_workspace_id_website_id_content_profile_id_started_idx" ON "ai_runs"("workspace_id", "website_id", "content_profile_id", "started_at");
CREATE INDEX "ai_runs_status_started_at_idx" ON "ai_runs"("status", "started_at");

ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_website_id_workspace_id_fkey" FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_content_profile_scope_fkey" FOREIGN KEY ("content_profile_id", "workspace_id", "website_id") REFERENCES "content_profiles"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_website_id_workspace_id_fkey" FOREIGN KEY ("website_id", "workspace_id") REFERENCES "websites"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_content_profile_scope_fkey" FOREIGN KEY ("content_profile_id", "workspace_id", "website_id") REFERENCES "content_profiles"("id", "workspace_id", "website_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_configuration_id_workspace_id_fkey" FOREIGN KEY ("configuration_id", "workspace_id") REFERENCES "ai_configurations"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
