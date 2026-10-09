CREATE TYPE "public"."ai_call_kind" AS ENUM('vision', 'embed', 'post_extract');--> statement-breakpoint
CREATE TYPE "public"."ai_call_outcome" AS ENUM('ok', 'invalid_output', 'error', 'budget_blocked');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('pending', 'processing', 'tagged', 'flagged', 'failed');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "ai_call_kind" NOT NULL,
	"model" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"job_id" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8) DEFAULT 0 NOT NULL,
	"billed_usd" numeric(12, 8) DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"outcome" "ai_call_outcome" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_tags" (
	"image_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "image_tags_image_id_tag_pk" PRIMARY KEY("image_id","tag")
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" uuid,
	"file_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "image_status" DEFAULT 'pending' NOT NULL,
	"flag_reason" text,
	"subject" text,
	"subject_label" text,
	"category" text,
	"caption" text,
	"confidence" real,
	"raw_response" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dir" text NOT NULL,
	"total" integer NOT NULL,
	"enqueued" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_unique" UNIQUE("name"),
	CONSTRAINT "workspaces_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_tags" ADD CONSTRAINT "image_tags_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_batch_id_ingest_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingest_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_workspace_created_idx" ON "ai_calls" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_subject_idx" ON "ai_calls" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_calls_job_idx" ON "ai_calls" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "image_tags_tag_idx" ON "image_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "images_workspace_hash_uq" ON "images" USING btree ("workspace_id","content_hash");--> statement-breakpoint
CREATE INDEX "images_workspace_status_idx" ON "images" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "images_workspace_label_idx" ON "images" USING btree ("workspace_id","subject_label");--> statement-breakpoint
CREATE INDEX "images_batch_idx" ON "images" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ingest_batches_workspace_idx" ON "ingest_batches" USING btree ("workspace_id","created_at");