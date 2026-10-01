// Log một dòng một sự kiện, có giờ — đủ cho docker logs; chưa cần thư viện log.

type Level = "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
  const stream = level === "info" ? console.log : console.error;
  if (extra === undefined) stream(line);
  else stream(line, extra instanceof Error ? extra.message : extra);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, extra?: unknown) => write("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => write("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => write("error", scope, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
