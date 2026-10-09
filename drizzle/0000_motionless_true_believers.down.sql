-- Paired rollback for 0000_motionless_true_believers.sql: drops every table the migration creates, children first.
DROP TABLE IF EXISTS "wallets" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "trader_stats" CASCADE;
DROP TABLE IF EXISTS "replies" CASCADE;
DROP TABLE IF EXISTS "reactions" CASCADE;
DROP TABLE IF EXISTS "positions" CASCADE;
DROP TABLE IF EXISTS "markets" CASCADE;
DROP TABLE IF EXISTS "indexer_state" CASCADE;
DROP TABLE IF EXISTS "feed_posts" CASCADE;
DROP TABLE IF EXISTS "curator_stats" CASCADE;
DROP TABLE IF EXISTS "curator_calls" CASCADE;
DROP TABLE IF EXISTS "creators" CASCADE;
DROP TABLE IF EXISTS "creator_accruals" CASCADE;
DROP TABLE IF EXISTS "copies" CASCADE;
