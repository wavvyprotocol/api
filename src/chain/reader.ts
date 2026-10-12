import {
  createPublicClient,
  decodeEventLog,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import type { Env } from "../env.ts";
import type { Logger } from "../log.ts";

const ammAbi = [
  {
    type: "function",
    name: "markPrice",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "fundingGrowth",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "int256" }],
  },
  {
    type: "function",
    name: "openInterest",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "long", type: "uint256" },
      { name: "short", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "marketExists",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const factoryAbi = [
  {
    type: "function",
    name: "marketExists",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "marketTypeOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "metricOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "creatorIdsOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "bytes32[]" }],
  },
] as const;

const oracleAbi = [
  {
    type: "function",
    name: "latestValue",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTWAP",
    stateMutability: "view",
    inputs: [
      { name: "metricId", type: "bytes32" },
      { name: "window", type: "uint64" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lastUpdateAt",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "isFresh",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isSuspended",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isFrozen",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "metricConfig",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [
      { name: "heartbeat", type: "uint64" },
      { name: "twapWindow", type: "uint64" },
      { name: "minTwapWindow", type: "uint64" },
      { name: "maxDeviationBps", type: "uint16" },
      { name: "circuitBreakerBps", type: "uint16" },
      { name: "registered", type: "bool" },
    ],
  },
] as const;

const indexOracleAbi = [
  {
    type: "function",
    name: "indexValue",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "value", type: "uint256" },
      { name: "valid", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "constituentCount",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const positionAbi = [
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "marketId", type: "uint256" },
          { name: "isLong", type: "bool" },
          { name: "size", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "margin", type: "uint256" },
          { name: "lastFundingGrowth", type: "int256" },
          { name: "openedAt", type: "uint64" },
          { name: "callId", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "exists",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const creatorRewardsAbi = [
  {
    type: "function",
    name: "creatorInfo",
    stateMutability: "view",
    inputs: [{ name: "creatorId", type: "bytes32" }],
    outputs: [
      { name: "wallet", type: "address" },
      { name: "pendingWallet", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "lastAccrualAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "balanceOfCreator",
    stateMutability: "view",
    inputs: [{ name: "creatorId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const curatorAbi = [
  {
    type: "event",
    name: "CallCreated",
    inputs: [
      { name: "callId", type: "uint256", indexed: true },
      { name: "curator", type: "address", indexed: true },
      { name: "marketId", type: "uint256", indexed: true },
      { name: "isLong", type: "bool", indexed: false },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "attributionOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "callCurator",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "copiesOf",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "curator", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type MarketInfo = {
  marketId: number;
  exists: boolean;
  type: "single_name" | "index" | "unknown";
  metricId: `0x${string}` | null;
  creatorIds: `0x${string}`[];
  markPrice: bigint | null;
  fundingGrowth: bigint;
  openInterestLong: bigint;
  openInterestShort: bigint;
};

export type OracleStatus = {
  metricId: `0x${string}`;
  value: bigint;
  twap: bigint | null;
  lastUpdateAt: number;
  fresh: boolean;
  suspended: boolean;
  frozen: boolean;
  registered: boolean;
  state: "fresh" | "stale" | "suspended" | "frozen" | "not_registered";
};

/// `oracleStatus` for a list of metrics, plus the 24 hour TWAP the market list
/// needs for its change reading.
export type OracleStatusBatchEntry = OracleStatus & { twap24h: bigint | null };

export const DAY_SECONDS = 86_400;

export type ChainPosition = {
  tokenId: string;
  marketId: number;
  isLong: boolean;
  size: bigint;
  entryPrice: bigint;
  margin: bigint;
  lastFundingGrowth: bigint;
  openedAt: number;
  callId: string;
  owner: `0x${string}`;
};

export type StakeVerification =
  | { status: "verified"; callId: string; stake: bigint }
  | { status: "pending" }
  | { status: "rejected"; reason: string };

export type ChainReader = {
  marketInfo(marketId: number): Promise<MarketInfo>;
  /// Reads many markets in two batched calls instead of two calls per market.
  marketInfoBatch(marketIds: readonly number[]): Promise<Map<number, MarketInfo>>;
  oracleStatus(metricId: `0x${string}`): Promise<OracleStatus>;
  /// Reads many oracle states in two batched calls; unreadable metrics are absent
  /// from the map rather than failing the whole list.
  oracleStatusBatch(
    metricIds: readonly `0x${string}`[],
  ): Promise<Map<`0x${string}`, OracleStatusBatchEntry>>;
  indexValue(marketId: number): Promise<{ value: bigint; valid: boolean } | null>;
  twap(metricId: `0x${string}`, windowSeconds: number): Promise<bigint | null>;
  position(tokenId: string): Promise<ChainPosition | null>;
  creatorEscrow(creatorId: `0x${string}`): Promise<bigint>;
  creatorInfo(creatorId: `0x${string}`): Promise<{
    wallet: `0x${string}`;
    pendingWallet: `0x${string}`;
    balance: bigint;
    lastAccrualAt: number;
  }>;
  curatorClaimable(curator: `0x${string}`): Promise<bigint>;
  latestBlockNumber(): Promise<number>;
  verifyStake(args: {
    txHash: `0x${string}`;
    curator: `0x${string}`;
    marketId: number;
    stakeAmount: bigint;
  }): Promise<StakeVerification>;
};

export type ChainConfig = Pick<
  Env,
  | "MONAD_TESTNET_RPC_URL"
  | "MONAD_CHAIN_ID"
  | "WAVVY_ORACLE_ADDRESS"
  | "WAVVY_INDEX_ORACLE_ADDRESS"
  | "WAVVY_AMM_ADDRESS"
  | "WAVVY_FACTORY_ADDRESS"
  | "WAVVY_POSITION_ADDRESS"
  | "WAVVY_CREATOR_REWARDS_ADDRESS"
  | "WAVVY_CURATOR_ADDRESS"
  | "MULTICALL3_ADDRESS"
>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function required(address: string | undefined, name: string): `0x${string}` {
  if (!address) {
    throw new Error(`${name} is required for chain reads`);
  }
  return address as `0x${string}`;
}

export function createChainReader(env: ChainConfig, logger: Logger): ChainReader {
  const chain = {
    id: env.MONAD_CHAIN_ID,
    name: env.MONAD_CHAIN_ID === 143 ? "Monad Mainnet" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [env.MONAD_TESTNET_RPC_URL] } },
  } as const satisfies Chain;
  const client: PublicClient = createPublicClient({ chain, transport: http(env.MONAD_TESTNET_RPC_URL) });

  const oracle = required(env.WAVVY_ORACLE_ADDRESS, "WAVVY_ORACLE_ADDRESS");
  const indexOracle = required(env.WAVVY_INDEX_ORACLE_ADDRESS, "WAVVY_INDEX_ORACLE_ADDRESS");
  const amm = required(env.WAVVY_AMM_ADDRESS, "WAVVY_AMM_ADDRESS");
  const factory = required(env.WAVVY_FACTORY_ADDRESS, "WAVVY_FACTORY_ADDRESS");
  const position = required(env.WAVVY_POSITION_ADDRESS, "WAVVY_POSITION_ADDRESS");
  const creatorRewards = required(env.WAVVY_CREATOR_REWARDS_ADDRESS, "WAVVY_CREATOR_REWARDS_ADDRESS");
  const curator = required(env.WAVVY_CURATOR_ADDRESS, "WAVVY_CURATOR_ADDRESS");
  const curatorContract = curator;

  const cacheTtlMs = Number(process.env.CHAIN_CACHE_TTL_MS ?? 5_000);
  const cache = new Map<string, { value: unknown; expiresAt: number }>();
  const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && hit.expiresAt > now) {
      return hit.value as T;
    }
    const value = await load();
    cache.set(key, { value, expiresAt: now + cacheTtlMs });
    if (cache.size > 500) {
      cache.clear();
    }
    return value;
  };

  type BatchCall = {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  };

  const multicallAddress = env.MULTICALL3_ADDRESS as `0x${string}`;
  const multicall = client.multicall as unknown as (input: {
    contracts: readonly BatchCall[];
    allowFailure: true;
    multicallAddress: `0x${string}`;
  }) => Promise<Array<{ status: "success" | "failure"; result?: unknown }>>;

  type BatchValue<T> = { ok: true; value: T } | { ok: false };

  /// Individual failures are reported per entry: a market that does not exist
  /// makes `marketTypeOf` revert, and that must not fail the other entries.
  const readBatch = async <T>(contracts: readonly BatchCall[]): Promise<Array<BatchValue<T>>> => {
    if (contracts.length === 0) {
      return [];
    }
    try {
      const results = await multicall({ contracts, allowFailure: true, multicallAddress });
      return results.map((entry) =>
        entry.status === "success"
          ? ({ ok: true, value: entry.result as T } as const)
          : ({ ok: false } as const),
      );
    } catch (error) {
      // Sequential on purpose: a wake of parallel calls is what trips a shared
      // RPC rate limit, and this path only runs when batching is unavailable.
      logger.debug("multicall unavailable, reading individually", {
        count: contracts.length,
        cause: error instanceof Error ? error.message : String(error),
      });
      const values: Array<BatchValue<T>> = [];
      for (const contract of contracts) {
        try {
          values.push({
            ok: true,
            value: (await client.readContract({
              address: contract.address,
              abi: contract.abi,
              functionName: contract.functionName,
              args: contract.args,
            })) as T,
          });
        } catch (entryError) {
          logger.debug("chain read failed", {
            functionName: contract.functionName,
            address: contract.address,
            cause: entryError instanceof Error ? entryError.message : String(entryError),
          });
          values.push({ ok: false });
        }
      }
      return values;
    }
  };

  const pick = <T>(entry: BatchValue<T> | undefined, fallback: T): T =>
    entry !== undefined && entry.ok ? entry.value : fallback;

  const zeroMetric = `0x${"0".repeat(64)}` as `0x${string}`;
  type OracleConfig = readonly [bigint, bigint, bigint, number, number, boolean];
  type OracleStateValue = bigint | boolean | OracleConfig;

  const marketFactoryCalls = (marketId: number): BatchCall[] => [
    { address: factory, abi: factoryAbi, functionName: "marketExists", args: [BigInt(marketId)] },
    { address: factory, abi: factoryAbi, functionName: "marketTypeOf", args: [BigInt(marketId)] },
  ];

  const marketStateCalls = (marketId: number): BatchCall[] => [
    { address: factory, abi: factoryAbi, functionName: "metricOf", args: [BigInt(marketId)] },
    { address: factory, abi: factoryAbi, functionName: "creatorIdsOf", args: [BigInt(marketId)] },
    { address: amm, abi: ammAbi, functionName: "markPrice", args: [BigInt(marketId)] },
    { address: amm, abi: ammAbi, functionName: "fundingGrowth", args: [BigInt(marketId)] },
    { address: amm, abi: ammAbi, functionName: "openInterest", args: [BigInt(marketId)] },
  ];

  const oracleStateCalls = (metricId: `0x${string}`): BatchCall[] => [
    { address: oracle, abi: oracleAbi, functionName: "latestValue", args: [metricId] },
    { address: oracle, abi: oracleAbi, functionName: "lastUpdateAt", args: [metricId] },
    { address: oracle, abi: oracleAbi, functionName: "isFresh", args: [metricId] },
    { address: oracle, abi: oracleAbi, functionName: "isSuspended", args: [metricId] },
    { address: oracle, abi: oracleAbi, functionName: "isFrozen", args: [metricId] },
    { address: oracle, abi: oracleAbi, functionName: "metricConfig", args: [metricId] },
  ];

  const missingMarket = (marketId: number): MarketInfo => ({
    marketId,
    exists: false,
    type: "unknown",
    metricId: null,
    creatorIds: [],
    markPrice: null,
    fundingGrowth: 0n,
    openInterestLong: 0n,
    openInterestShort: 0n,
  });

  const assembleMarketInfo = (
    marketId: number,
    typeEntry: BatchValue<boolean | number> | undefined,
    state: ReadonlyArray<BatchValue<`0x${string}` | `0x${string}`[] | bigint | readonly [bigint, bigint]>>,
  ): MarketInfo => {
    const metricId = pick(state[0] as BatchValue<`0x${string}`> | undefined, zeroMetric);
    const interest = pick(
      state[4] as BatchValue<readonly [bigint, bigint]> | undefined,
      [0n, 0n] as const,
    );
    return {
      marketId,
      exists: true,
      type: Number(pick(typeEntry, 0)) === 1 ? "index" : "single_name",
      metricId: metricId === zeroMetric ? null : metricId,
      creatorIds: [
        ...pick(state[1] as BatchValue<`0x${string}`[]> | undefined, []),
      ],
      markPrice: pick(state[2] as BatchValue<bigint> | undefined, 0n),
      fundingGrowth: pick(state[3] as BatchValue<bigint> | undefined, 0n),
      openInterestLong: interest[0],
      openInterestShort: interest[1],
    };
  };

  const assembleOracleStatus = (
    metricId: `0x${string}`,
    state: ReadonlyArray<BatchValue<OracleStateValue>>,
    twaps: { twap: bigint | null; twap24h: bigint | null },
  ): OracleStatusBatchEntry => {
    const config = pick(
      state[5] as BatchValue<OracleConfig> | undefined,
      [0n, 0n, 0n, 0, 0, false] as const,
    );
    const registered = config[5];
    const fresh = pick(state[2] as BatchValue<boolean> | undefined, false);
    const suspended = pick(state[3] as BatchValue<boolean> | undefined, false);
    const frozen = pick(state[4] as BatchValue<boolean> | undefined, false);
    const stateName = !registered
      ? ("not_registered" as const)
      : frozen
        ? ("frozen" as const)
        : suspended
          ? ("suspended" as const)
          : fresh
            ? ("fresh" as const)
            : ("stale" as const);
    return {
      metricId,
      value: pick(state[0] as BatchValue<bigint> | undefined, 0n),
      twap: registered ? twaps.twap : null,
      twap24h: registered ? twaps.twap24h : null,
      lastUpdateAt: Number(pick(state[1] as BatchValue<bigint> | undefined, 0n)),
      fresh,
      suspended,
      frozen,
      registered,
      state: stateName,
    };
  };

  logger.info("chain reader ready", {
    chainId: chain.id,
    rpcHost: new URL(env.MONAD_TESTNET_RPC_URL).host,
  });

  return {
    async marketInfo(marketId): Promise<MarketInfo> {
      return cached(`market:${marketId}`, async () => {
        const factoryResults = await readBatch<boolean | number>(marketFactoryCalls(marketId));
        if (pick(factoryResults[0] as BatchValue<boolean> | undefined, false) !== true) {
          return missingMarket(marketId);
        }
        const state = await readBatch<`0x${string}` | `0x${string}`[] | bigint | readonly [bigint, bigint]>(
          marketStateCalls(marketId),
        );
        return assembleMarketInfo(
          marketId,
          factoryResults[1] as BatchValue<boolean | number> | undefined,
          state,
        );
      });
    },

    async marketInfoBatch(marketIds): Promise<Map<number, MarketInfo>> {
      const unique = [...new Set(marketIds)];
      const result = new Map<number, MarketInfo>();
      if (unique.length === 0) {
        return result;
      }
      const factoryResults = await readBatch<boolean | number>(
        unique.flatMap((marketId) => marketFactoryCalls(marketId)),
      );
      const existing = unique.filter(
        (_, index) =>
          pick(factoryResults[index * 2] as BatchValue<boolean> | undefined, false) === true,
      );
      const state = await readBatch<`0x${string}` | `0x${string}`[] | bigint | readonly [bigint, bigint]>(
        existing.flatMap((marketId) => marketStateCalls(marketId)),
      );
      const stateIndex = new Map(existing.map((marketId, index) => [marketId, index]));
      for (const [index, marketId] of unique.entries()) {
        if (pick(factoryResults[index * 2] as BatchValue<boolean> | undefined, false) !== true) {
          result.set(marketId, missingMarket(marketId));
          continue;
        }
        const base = (stateIndex.get(marketId) ?? 0) * 5;
        result.set(
          marketId,
          assembleMarketInfo(
            marketId,
            factoryResults[index * 2 + 1] as BatchValue<boolean | number> | undefined,
            state.slice(base, base + 5),
          ),
        );
      }
      return result;
    },

    async oracleStatus(metricId): Promise<OracleStatus> {
      const state = await readBatch<OracleStateValue>(oracleStateCalls(metricId));
      const config = pick(
        state[5] as BatchValue<OracleConfig> | undefined,
        [0n, 0n, 0n, 0, 0, false] as const,
      );
      const twapResults =
        config[5] === true
          ? await readBatch<bigint>([
              { address: oracle, abi: oracleAbi, functionName: "getTWAP", args: [metricId, config[1]] },
            ])
          : [];
      return assembleOracleStatus(metricId, state, {
        twap: pick(twapResults[0] as BatchValue<bigint> | undefined, null as bigint | null),
        twap24h: null,
      });
    },

    async oracleStatusBatch(metricIds): Promise<Map<`0x${string}`, OracleStatusBatchEntry>> {
      const unique = [...new Set(metricIds)];
      const result = new Map<`0x${string}`, OracleStatusBatchEntry>();
      if (unique.length === 0) {
        return result;
      }
      const state = await readBatch<OracleStateValue>(
        unique.flatMap((metricId) => oracleStateCalls(metricId)),
      );
      const registered = unique.flatMap((metricId, index) => {
        const configEntry = state[index * 6 + 5] as BatchValue<OracleConfig> | undefined;
        if (configEntry === undefined || !configEntry.ok || configEntry.value[5] !== true) {
          return [];
        }
        return [{ metricId, window: configEntry.value[1] }];
      });
      const twapResults =
        registered.length > 0
          ? await readBatch<bigint>(
              registered.flatMap((entry) => [
                {
                  address: oracle,
                  abi: oracleAbi,
                  functionName: "getTWAP",
                  args: [entry.metricId, entry.window],
                },
                {
                  address: oracle,
                  abi: oracleAbi,
                  functionName: "getTWAP",
                  args: [entry.metricId, BigInt(DAY_SECONDS)],
                },
              ]),
            )
          : [];
      const twapIndex = new Map(registered.map((entry, index) => [entry.metricId, index]));
      for (const [index, metricId] of unique.entries()) {
        const twapPosition = twapIndex.get(metricId);
        result.set(
          metricId,
          assembleOracleStatus(metricId, state.slice(index * 6, index * 6 + 6), {
            twap:
              twapPosition === undefined
                ? null
                : pick(twapResults[twapPosition * 2] as BatchValue<bigint> | undefined, null as bigint | null),
            twap24h:
              twapPosition === undefined
                ? null
                : pick(
                    twapResults[twapPosition * 2 + 1] as BatchValue<bigint> | undefined,
                    null as bigint | null,
                  ),
          }),
        );
      }
      return result;
    },

    async twap(metricId, windowSeconds) {
      try {
        return await client.readContract({
          address: oracle,
          abi: oracleAbi,
          functionName: "getTWAP",
          args: [metricId, BigInt(windowSeconds)],
        });
      } catch {
        return null;
      }
    },

    async indexValue(marketId) {
      const [value, valid] = await client.readContract({
        address: indexOracle,
        abi: indexOracleAbi,
        functionName: "indexValue",
        args: [BigInt(marketId)],
      });
      return { value, valid };
    },

    async position(tokenId): Promise<ChainPosition | null> {
      const exists = await client.readContract({
        address: position,
        abi: positionAbi,
        functionName: "exists",
        args: [BigInt(tokenId)],
      });
      if (!exists) {
        return null;
      }
      const [data, owner] = await Promise.all([
        client.readContract({ address: position, abi: positionAbi, functionName: "getPosition", args: [BigInt(tokenId)] }),
        client.readContract({ address: position, abi: positionAbi, functionName: "ownerOf", args: [BigInt(tokenId)] }),
      ]);
      return {
        tokenId,
        marketId: Number(data.marketId),
        isLong: data.isLong,
        size: data.size,
        entryPrice: data.entryPrice,
        margin: data.margin,
        lastFundingGrowth: data.lastFundingGrowth,
        openedAt: Number(data.openedAt),
        callId: data.callId.toString(),
        owner: owner === ZERO_ADDRESS ? ZERO_ADDRESS : owner,
      };
    },

    async creatorEscrow(creatorId) {
      return client.readContract({
        address: creatorRewards,
        abi: creatorRewardsAbi,
        functionName: "balanceOfCreator",
        args: [creatorId],
      });
    },

    async creatorInfo(creatorId) {
      const [wallet, pendingWallet, balance, lastAccrualAt] = await client.readContract({
        address: creatorRewards,
        abi: creatorRewardsAbi,
        functionName: "creatorInfo",
        args: [creatorId],
      });
      return { wallet, pendingWallet, balance, lastAccrualAt: Number(lastAccrualAt) };
    },

    async curatorClaimable(curatorAddress) {
      return client.readContract({
        address: curator,
        abi: curatorAbi,
        functionName: "claimable",
        args: [curatorAddress],
      });
    },

    async latestBlockNumber() {
      return Number(await client.getBlockNumber());
    },

    async verifyStake({ txHash, curator, marketId, stakeAmount }): Promise<StakeVerification> {
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: txHash });
      } catch {
        return { status: "pending" };
      }
      if (!receipt) {
        return { status: "pending" };
      }
      if (receipt.status !== "success") {
        return { status: "rejected", reason: "the stake transaction reverted" };
      }
      if (receipt.to?.toLowerCase() !== curatorContract.toLowerCase()) {
        return { status: "rejected", reason: "the transaction did not target WavvyCurator" };
      }
      try {
        const transaction = await client.getTransaction({ hash: txHash });
        if (transaction.from.toLowerCase() !== curator.toLowerCase()) {
          return { status: "rejected", reason: "the stake was paid by a different wallet" };
        }
      } catch {
        return { status: "rejected", reason: "could not read the stake transaction sender" };
      }

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== curatorContract.toLowerCase()) {
          continue;
        }
        try {
          const decoded = decodeEventLog({ abi: curatorAbi, data: log.data, topics: log.topics });
          if (decoded.eventName !== "CallCreated") {
            continue;
          }
          const args = decoded.args as unknown as {
            callId: bigint;
            curator: `0x${string}`;
            marketId: bigint;
            isLong: boolean;
            stake: bigint;
          };
          if (args.curator.toLowerCase() !== curator.toLowerCase()) {
            return { status: "rejected", reason: "the call belongs to a different wallet" };
          }
          if (Number(args.marketId) !== marketId) {
            return { status: "rejected", reason: "the staked call is for a different market" };
          }
          if (args.stake !== stakeAmount) {
            return { status: "rejected", reason: "the staked amount does not match the transaction" };
          }
          return { status: "verified", callId: args.callId.toString(), stake: args.stake };
        } catch {
          continue;
        }
      }
      return { status: "rejected", reason: "no CallCreated event from WavvyCurator in this transaction" };
    },
  };
}