import { pino } from "pino";

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
      instance.error(context ?? {}, message);
    },
    warn(message: string, context?: LogContext): void {
      instance.warn(context ?? {}, message);
    },
    success(message: string, context?: LogContext): void {
      instance.success(context ?? {}, message);
    },
    info(message: string, context?: LogContext): void {
      instance.info(context ?? {}, message);
    },
    debug(message: string, context?: LogContext): void {
      instance.debug(context ?? {}, message);
    },
  };
}

export const logger: Logger = createLogger();