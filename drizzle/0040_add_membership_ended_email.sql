ALTER TABLE "users" ADD COLUMN "membership_was_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "users" SET "membership_was_active" = EXISTS (
	SELECT 1 FROM "user_activations" a
	WHERE a."user_id" = "users"."id"
		AND a."start_date" <= (now() AT TIME ZONE 'UTC')::date
		AND a."end_date" >= (now() AT TIME ZONE 'UTC')::date
);
