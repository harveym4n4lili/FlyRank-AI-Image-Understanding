CREATE TYPE "public"."review_action" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"action" "review_action" NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Existing rows predate threshold snapshots: backfill with {} (re-running a match fills the real config).
ALTER TABLE "suggestions" ADD COLUMN "guard_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestions" ALTER COLUMN "guard_config" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_actions_workspace_key_uq" ON "review_actions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "review_actions_suggestion_idx" ON "review_actions" USING btree ("suggestion_id");