CREATE TABLE "copies" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"copier_user_id" text NOT NULL,
	"position_token_id" text NOT NULL,
	"attributed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_accruals" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"period" text NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_tx_hash" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"wallet_address" text,
	"verified_at" timestamp with time zone,
	"verification_status" text DEFAULT 'unclaimed' NOT NULL,
	"verification_challenge" text,
	"challenge_issued_at" timestamp with time zone,
	"proof_url" text,
	"proof_submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_creator_id_unique" UNIQUE("creator_id")
);
--> statement-breakpoint
CREATE TABLE "curator_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"curator_user_id" text NOT NULL,
	"target_trader" text NOT NULL,
	"market_id" integer,
	"thesis" varchar(280) NOT NULL,
	"stake_amount" numeric NOT NULL,
	"stake_tx_hash" text,
	"onchain_call_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_stats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"active_calls" integer DEFAULT 0 NOT NULL,
	"total_staked" numeric DEFAULT '0' NOT NULL,
	"copier_count" integer DEFAULT 0 NOT NULL,
	"closed_calls" integer DEFAULT 0 NOT NULL,
	"profitable_calls" integer DEFAULT 0 NOT NULL,
	"reputation" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_posts" (
	"position_token_id" text PRIMARY KEY NOT NULL,
	"thesis" varchar(280),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_block" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" integer PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"metric_id" text,
	"creator_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"baseline_values" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"token_id" text PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"owner_address" text NOT NULL,
	"side" text NOT NULL,
	"leverage" numeric NOT NULL,
	"margin" numeric NOT NULL,
	"entry_price" numeric NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"realized_pnl" numeric,
	"tx_hash" text,
	"block_number" bigint
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" varchar(280) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_stats" (
	"address" text PRIMARY KEY NOT NULL,
	"win_rate" numeric DEFAULT '0' NOT NULL,
	"total_pnl" numeric DEFAULT '0' NOT NULL,
	"closed_positions" integer DEFAULT 0 NOT NULL,
	"consistency" numeric DEFAULT '0' NOT NULL,
	"copier_count" integer DEFAULT 0 NOT NULL,
	"reputation" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"privy_id" text NOT NULL,
	"farcaster_fid" integer,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_id_unique" UNIQUE("privy_id")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_call_id_curator_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."curator_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_copier_user_id_users_id_fk" FOREIGN KEY ("copier_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_accruals" ADD CONSTRAINT "creator_accruals_creator_id_creators_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_calls" ADD CONSTRAINT "curator_calls_curator_user_id_users_id_fk" FOREIGN KEY ("curator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_position_token_id_positions_token_id_fk" FOREIGN KEY ("position_token_id") REFERENCES "public"."positions"("token_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_feed_posts_position_token_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("position_token_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_post_id_feed_posts_position_token_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("position_token_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copies_position_idx" ON "copies" USING btree ("position_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_accruals_period_idx" ON "creator_accruals" USING btree ("creator_id","period","tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_platform_handle_idx" ON "creators" USING btree ("platform","handle");--> statement-breakpoint
CREATE INDEX "curator_calls_curator_idx" ON "curator_calls" USING btree ("curator_user_id");--> statement-breakpoint
CREATE INDEX "positions_owner_idx" ON "positions" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "positions_market_idx" ON "positions" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_unique_idx" ON "reactions" USING btree ("post_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "reactions_post_idx" ON "reactions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "replies_post_idx" ON "replies" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");