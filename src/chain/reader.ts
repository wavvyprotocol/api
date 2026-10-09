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
  oracleStatus(metricId: `0x${string}`): Promise<OracleStatus>;
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

  const readBatch = async <T>(contracts: readonly BatchCall[]): Promise<T[]> => {
    try {
      const results = await multicall({ contracts, allowFailure: true, multicallAddress });
      return results.map((entry, index) => {
        if (entry.status === "success") {
          return entry.result as T;
        }
        throw new Error(`batch call ${contracts[index]?.functionName ?? index} failed`);
      });
    } catch {
      return Promise.all(
        contracts.map(
          (contract) =>
            client.readContract({
              address: contract.address,
              abi: contract.abi,
              functionName: contract.functionName,
              args: contract.args,
            }) as Promise<T>,
        ),
      );
    }
  };

  logger.info("chain reader ready", {
    chainId: chain.id,
    rpcHost: new URL(env.MONAD_TESTNET_RPC_URL).host,
  });

  return {
    async marketInfo(marketId): Promise<MarketInfo> {
      return cached(`market:${marketId}`, async () => {
        const [exists, typeRaw] = await readBatch<boolean | number>([
          { address: factory, abi: factoryAbi, functionName: "marketExists", args: [BigInt(marketId)] },
          { address: factory, abi: factoryAbi, functionName: "marketTypeOf", args: [BigInt(marketId)] },
        ]);
        if (!exists) {
          return {
            marketId,
            exists: false,
            type: "unknown" as const,
            metricId: null,
            creatorIds: [],
            markPrice: null,
            fundingGrowth: 0n,
            openInterestLong: 0n,
            openInterestShort: 0n,
          };
        }

        const [metricId, creatorIds, markPrice, fundingGrowth, openInterest] = await readBatch<
          `0x${string}` | `0x${string}`[] | bigint | readonly [bigint, bigint]
        >([
          { address: factory, abi: factoryAbi, functionName: "metricOf", args: [BigInt(marketId)] },
          { address: factory, abi: factoryAbi, functionName: "creatorIdsOf", args: [BigInt(marketId)] },
          { address: amm, abi: ammAbi, functionName: "markPrice", args: [BigInt(marketId)] },
          { address: amm, abi: ammAbi, functionName: "fundingGrowth", args: [BigInt(marketId)] },
          { address: amm, abi: ammAbi, functionName: "openInterest", args: [BigInt(marketId)] },
        ]);
        const interest = openInterest as readonly [bigint, bigint];

        return {
          marketId,
          exists: true,
          type: Number(typeRaw) === 1 ? ("index" as const) : ("single_name" as const),
          metricId: metricId === `0x${"0".repeat(64)}` ? null : (metricId as `0x${string}`),
          creatorIds: [...(creatorIds as `0x${string}`[])],
          markPrice: markPrice as bigint,
          fundingGrowth: fundingGrowth as bigint,
          openInterestLong: interest[0],
          openInterestShort: interest[1],
        };
      });
    },

    async oracleStatus(metricId): Promise<OracleStatus> {
      const [value, lastUpdateAt, fresh, suspended, frozen, config] = await readBatch<
        bigint | boolean | readonly [bigint, bigint, bigint, number, number, boolean]
      >([
        { address: oracle, abi: oracleAbi, functionName: "latestValue", args: [metricId] },
        { address: oracle, abi: oracleAbi, functionName: "lastUpdateAt", args: [metricId] },
        { address: oracle, abi: oracleAbi, functionName: "isFresh", args: [metricId] },
        { address: oracle, abi: oracleAbi, functionName: "isSuspended", args: [metricId] },
        { address: oracle, abi: oracleAbi, functionName: "isFrozen", args: [metricId] },
        { address: oracle, abi: oracleAbi, functionName: "metricConfig", args: [metricId] },
      ]).then((results) => results as [
        bigint,
        bigint,
        boolean,
        boolean,
        boolean,
        readonly [bigint, bigint, bigint, number, number, boolean],
      ]);
      const registered = config[5];
      const twap = registered
        ? await client.readContract({
            address: oracle,
            abi: oracleAbi,
            functionName: "getTWAP",
            args: [metricId, config[1]],
          })
        : null;
      const state: OracleStatus["state"] = !registered
        ? "not_registered"
        : frozen
          ? "frozen"
          : suspended
            ? "suspended"
            : fresh
              ? "fresh"
              : "stale";
      return {
        metricId,
        value,
        twap,
        lastUpdateAt: Number(lastUpdateAt),
        fresh,
        suspended,
        frozen,
        registered,
        state,
      };
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