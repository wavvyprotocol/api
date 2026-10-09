-- Paired rollback for 0001_flawless_sue_storm.sql
DROP INDEX IF EXISTS "creator_accruals_event_idx";
DROP INDEX IF EXISTS "creator_accruals_period_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "creator_accruals_period_idx" ON "creator_accruals" ("creator_id", "period", "tx_hash");
ALTER TABLE "curator_calls" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "creators" DROP COLUMN IF EXISTS "verification_user_id";
