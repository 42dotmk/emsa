CREATE TABLE "point_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"project_id" uuid,
	"project_title" varchar(255),
	"note" text,
	"context" jsonb,
	"created_by_id" uuid,
	"created_by_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "points_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "points_name" varchar(64) DEFAULT 'Points' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "points_icon_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "membership_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_registrations" ADD COLUMN "points_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "points" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "points_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "membership_points_held" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "point_transactions_user_created_idx" ON "point_transactions" USING btree ("user_id","created_at" DESC NULLS LAST);