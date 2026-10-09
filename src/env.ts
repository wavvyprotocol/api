import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((port) => port > 0 && port < 65536, "PORT must be a valid port")
    .default(8787),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(["error", "warn", "success", "info", "debug"]).optional(),
  DEBUG_LOGS: z.string().optional(),

  DATABASE_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),

  MONAD_TESTNET_RPC_URL: z.string().url().default("https://testnet-rpc.monad.xyz"),
  MONAD_CHAIN_ID: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(10143),
  MULTICALL3_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0xcA11bde05977b3631167028862bE2a173976CA11"),
  WAVVY_ORACLE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  WAVVY_INDEX_ORACLE_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  WAVVY_AMM_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  WAVVY_FACTORY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  WAVVY_POSITION_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  WAVVY_CREATOR_REWARDS_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  WAVVY_CURATOR_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  VERIFY_ADMIN_TOKEN: z.string().min(16).optional(),
  FRAME_SIGNING_SECRET: z.string().min(16).optional(),
  PUBLIC_APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid environment: ${details}`);
  }
  return parsed.data;
}

export type CapabilityReport = {
  database: boolean;
  rateLimitStore: boolean;
  privy: boolean;
};

export function capabilities(env: Env): CapabilityReport {
  return {
    database: env.DATABASE_URL !== undefined,
    rateLimitStore: env.UPSTASH_REDIS_REST_URL !== undefined && env.UPSTASH_REDIS_REST_TOKEN !== undefined,
    privy: env.PRIVY_APP_ID !== undefined && env.PRIVY_APP_SECRET !== undefined,
  };
}