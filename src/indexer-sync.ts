import type { Sql } from "postgres";
import type { Logger } from "./log.ts";

const SCHEMA_PATTERN = /^[A-Za-z0-9_]+$/;
const CHAIN_PATTERN = /^\d+$/;
const DEFAULT_INTERVAL_MS = 60_000;

export type SyncTableResult = { table: string; rows: number; error?: string };

export function syncIntervalMs(env: { SYNC_INTERVAL_MS?: string }): number | undefined {
  const raw = env.SYNC_INTERVAL_MS?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_INTERVAL_MS;
  }
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = Number(raw);
  return value === 0 ? undefined : value;
}

function statements(source: string, suffix: string): Array<{ label: string; query: string }> {
  return [
    {
      label: "markets",
      query: `
        insert into markets (id, type, metric_id, creator_ids, baseline_values, status, updated_at)
        select "marketId"::int,
               lower(type::text),
               "metricId",
               to_jsonb("creatorIds"),
               null,
               'active',
               now()
        from ${source}."Market${suffix}"
        on conflict (id) do update set
          type = excluded.type,
          metric_id = excluded.metric_id,
          creator_ids = excluded.creator_ids,
          updated_at = excluded.updated_at`,
    },
    {
      label: "positions",
      query: `
        insert into positions (token_id, market_id, owner_address, side, leverage, margin, entry_price,
                               opened_at, closed_at, status, realized_pnl, tx_hash, block_number)
        select "tokenId"::text,
               "marketId"::int,
               lower(holder),
               case when "isLong" then 'long' else 'short' end,
               case when "margin" > 0
                    then (("size"::numeric * "entryPrice"::numeric) / "margin"::numeric) / 1000000000000000000
                    else null end,
               "margin"::numeric,
               "entryPrice"::numeric,
               to_timestamp("openedAt"),
               case when "closedAt" is not null then to_timestamp("closedAt") else null end,
               lower(status::text),
               "realizedPnl"::numeric,
               "openedTxHash",
               "openedBlock"
        from ${source}."Position${suffix}"
        on conflict (token_id) do update set
          owner_address = excluded.owner_address,
          side = excluded.side,
          leverage = excluded.leverage,
          margin = excluded.margin,
          entry_price = excluded.entry_price,
          closed_at = excluded.closed_at,
          status = excluded.status,
          realized_pnl = excluded.realized_pnl`,
    },
    {
      label: "trader_stats",
      query: `
        insert into trader_stats (address, win_rate, total_pnl, closed_positions, consistency, copier_count, reputation, updated_at)
        select lower(wallet),
               ("winRateBps"::numeric / 10000),
               "realizedPnl"::numeric,
               "closedPositions" + "liquidatedPositions",
               ("consistencyBps"::numeric / 10000),
               "copierCount",
               "reputation"::numeric,
               now()
        from ${source}."TraderStats${suffix}"
        on conflict (address) do update set
          win_rate = excluded.win_rate,
          total_pnl = excluded.total_pnl,
          closed_positions = excluded.closed_positions,
          consistency = excluded.consistency,
          copier_count = excluded.copier_count,
          reputation = excluded.reputation,
          updated_at = excluded.updated_at`,
    },
    {
      label: "curator_stats",
      query: `
        insert into curator_stats (user_id, active_calls, total_staked, copier_count, closed_calls, profitable_calls, reputation, updated_at)
        select coalesce(w.user_id, lower(c."curator")),
               c."activeCalls",
               c."totalStaked"::numeric,
               c."copierCount",
               c."closedCalls",
               c."profitableCalls",
               c."reputation"::numeric,
               now()
        from ${source}."CuratorStats${suffix}" c
        left join wallets w on w.address = lower(c."curator")
        on conflict (user_id) do update set
          active_calls = excluded.active_calls,
          total_staked = excluded.total_staked,
          copier_count = excluded.copier_count,
          closed_calls = excluded.closed_calls,
          profitable_calls = excluded.profitable_calls,
          reputation = excluded.reputation,
          updated_at = excluded.updated_at`,
    },
    {
      label: "creator_accruals",
      query: `
        insert into creator_accruals (id, creator_id, amount, period, claimed_at, claim_tx_hash, tx_hash, created_at)
        select a.id,
               a."creatorId",
               a."amount"::numeric,
               to_char(to_timestamp(a."timestamp"), 'YYYY-MM'),
               case when a.kind::text = 'CLAIM' then to_timestamp(a."timestamp") else null end,
               case when a.kind::text = 'CLAIM' then a."txHash" else null end,
               a."txHash",
               to_timestamp(a."timestamp")
        from ${source}."CreatorAccrual${suffix}" a
        on conflict (id) do update set
          amount = excluded.amount,
          period = excluded.period,
          claimed_at = excluded.claimed_at,
          claim_tx_hash = excluded.claim_tx_hash`,
    },
    {
      label: "indexer_state",
      query: `
        insert into indexer_state (id, last_block, updated_at)
        select 'monad-testnet', "latest_processed_block", now()
        from ${source}.chain_metadata
        on conflict (id) do update set
          last_block = excluded.last_block,
          updated_at = excluded.updated_at`,
    },
  ];
}

export async function syncIndexerTables(options: {
  sql: Sql;
  schema: string;
  chainId: string;
  log: Logger;
}): Promise<SyncTableResult[]> {
  const { sql, schema, chainId, log } = options;
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new Error(`INDEXER_PG_SCHEMA must be a plain identifier, got ${JSON.stringify(schema)}`);
  }
  if (!CHAIN_PATTERN.test(chainId)) {
    throw new Error(`INDEXER_CHAIN_ID must be numeric, got ${JSON.stringify(chainId)}`);
  }

  const source = `"${schema}"`;
  const suffix = `$${chainId}`;
  const results: SyncTableResult[] = [];

  for (const statement of statements(source, suffix)) {
    try {
      const result = await sql.unsafe(statement.query);
      const rows = result.count ?? 0;
      results.push({ table: statement.label, rows });
      log.debug("indexer sync table complete", { table: statement.label, rows });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("indexer sync table failed", { table: statement.label, cause: message });
      results.push({ table: statement.label, rows: 0, error: message });
    }
  }

  return results;
}