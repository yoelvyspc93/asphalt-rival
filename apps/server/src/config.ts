const DEFAULT_PORT = 2567;

export interface ServerConfig {
  host: string;
  port: number;
  allowedOrigin: string;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

export function getServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: environment.HOST?.trim() || "0.0.0.0",
    port: parsePort(environment.PORT),
    allowedOrigin: environment.ALLOWED_ORIGIN?.trim() || "*",
  };
}
