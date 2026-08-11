import pino from "pino";

export function createLogger(component: string) {
  const level = process.env.ORCA_LOG_LEVEL ?? "info";
  return pino({
    name: component,
    level,
    transport:
      process.env.ORCA_LOG_PRETTY === "0"
        ? undefined
        : {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
          },
  });
}

export type Logger = ReturnType<typeof createLogger>;
