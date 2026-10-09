DROP INDEX "creator_accruals_period_idx";--> statement-breakpoint
ALTER TABLE "curator_calls" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "verification_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_accruals_event_idx" ON "creator_accruals" USING btree ("creator_id","period","tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_accruals_period_idx" ON "creator_accruals" USING btree ("creator_id","period") WHERE "creator_accruals"."tx_hash" is null;