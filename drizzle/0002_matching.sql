CREATE TYPE "public"."post_status" AS ENUM('pending', 'embedded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "image_embeddings" (
	"image_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"input_text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_embeddings" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"input_text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"subject" text,
	"subject_label" text,
	"category" text,
	"status" "post_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"similarity" real NOT NULL,
	"verdict" "verdict" NOT NULL,
	"reasons" jsonb NOT NULL,
	"guard_version" text NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_embeddings" ADD CONSTRAINT "image_embeddings_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_embeddings" ADD CONSTRAINT "post_embeddings_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_embeddings_hnsw_idx" ON "image_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "post_embeddings_hnsw_idx" ON "post_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "posts_workspace_slug_uq" ON "posts" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "posts_workspace_status_idx" ON "posts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestions_post_image_uq" ON "suggestions" USING btree ("post_id","image_id");--> statement-breakpoint
CREATE INDEX "suggestions_post_rank_idx" ON "suggestions" USING btree ("post_id","rank");--> statement-breakpoint
CREATE INDEX "suggestions_workspace_review_idx" ON "suggestions" USING btree ("workspace_id","review_status");