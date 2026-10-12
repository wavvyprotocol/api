import { pino } from "pino";

const SECRET_VALUES = [
  process.env.MONAD_TESTNET_RPC_URL,
  process.env.DATABASE_URL,
  process.env.PRIVY_APP_SECRET,
  process.env.VERIFY_ADMIN_TOKEN,
  process.env.FRAME_SIGNING_SECRET,
  process.env.UPSTASH_REDIS_REST_TOKEN,
  process.env.ENVIO_API_TOKEN,
].filter((value): value is string => typeof value === "string" && value.length >= 8);

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // Access keys sit in the URL path: https://host/v1/<key>, or a single long
  // segment the way QuickNode issues endpoints.
  [/(https?:\/\/[^/\s]+\/)[A-Za-z0-9_-]{16,}/g, "$1[redacted]"],
  [/\/v1\/[A-Za-z0-9_-]{6,}/g, "/v1/[redacted]"],
  [/(:\/\/)[^/@\s]+:[^/@\s]+@/g, "$1[redacted]@"],
  [/([?&](?:api[-_]?key|apikey|access[-_]?token|token|key)=)[^&\s]+/gi, "$1[redacted]"],
];

export function redactText(input: string): string {
  let output = input;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  for (const secret of SECRET_VALUES) {
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack === undefined ? undefined : redactText(value.stack),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (value !== null && typeof value === "object" && depth < 5) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, depth + 1)]),
    );
  }
  return value;
}

export type LogContext = Record<string, unknown>;

export type Logger = {
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  success(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
};

export function createLogger(options: { level?: string } = {}): Logger {
  const level =
    options.level ?? process.env.LOG_LEVEL ?? (process.env.DEBUG_LOGS === "true" ? "debug" : "info");
  const instance = pino({
    level,
    customLevels: { success: 35 },
    formatters: { level: (label) => ({ level: label }) },
  });

  return {
    error(message: string, context?: LogContext): void {
      instance.error(redactValue(context ?? {}) as LogContext, redactText(message));
    },
    warn(message: string, context?: LogContext): void {
      instance.warn(redactValue(context ?? {}) as LogContext, redactText(message));
    },
    success(message: string, context?: LogContext): void {
      instance.success(redactValue(context ?? {}) as LogContext, redactText(message));
    },
    info(message: string, context?: LogContext): void {
      instance.info(redactValue(context ?? {}) as LogContext, redactText(message));
    },
    debug(message: string, context?: LogContext): void {
      instance.debug(redactValue(context ?? {}) as LogContext, redactText(message));
    },
  };
}

export const logger: Logger = createLogger();