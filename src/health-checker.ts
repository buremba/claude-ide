import * as http from "http";
import * as https from "https";

export interface HealthCheckOptions {
  /** Full URL to check (e.g., https://localhost:3000/health) */
  url?: string;
  /** HTTP path to check (e.g., /api/health) */
  path?: string;
  /** Port to connect to */
  port?: number;
  /** Host to connect to (default: localhost) */
  host?: string;
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  statusCode?: number;
  error?: string;
  responseTime?: number;
}

/**
 * Perform a health check on an HTTP endpoint
 */
export function checkHealth(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const { url, path, port, host = "localhost", timeout = 5000 } = options;
  const startTime = Date.now();

  return new Promise((resolve) => {
    let requestOptions: http.RequestOptions;
    let transport: typeof http | typeof https = http;

    if (url) {
      const parsed = new URL(url);
      transport = parsed.protocol === "https:" ? https : http;
      requestOptions = {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        timeout,
      };
    } else {
      if (!path || !port) {
        resolve({
          healthy: false,
          error: "Missing health check target",
        });
        return;
      }

      requestOptions = {
        hostname: host,
        port,
        path,
        method: "GET",
        timeout,
      };
    }

    const req = transport.request(requestOptions, (res) => {
      const responseTime = Date.now() - startTime;
      const healthy = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400;

      // Consume the response to free up the socket
      res.resume();

      resolve({
        healthy,
        statusCode: res.statusCode,
        responseTime,
      });
    });

    req.on("error", (err) => {
      resolve({
        healthy: false,
        error: err.message,
        responseTime: Date.now() - startTime,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        healthy: false,
        error: "Timeout",
        responseTime: Date.now() - startTime,
      });
    });

    req.end();
  });
}

/**
 * Health checker that periodically checks a process's health endpoint
 */
export class HealthChecker {
  private interval: NodeJS.Timeout | null = null;
  private lastResult: HealthCheckResult | null = null;
  private options: HealthCheckOptions;
  private checkInterval: number;
  private onHealthChange?: (healthy: boolean) => void;

  constructor(
    options: HealthCheckOptions,
    checkInterval = 10000,
    onHealthChange?: (healthy: boolean) => void
  ) {
    this.options = options;
    this.checkInterval = checkInterval;
    this.onHealthChange = onHealthChange;
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.interval) return;

    // Initial check
    this.check();

    this.interval = setInterval(() => {
      this.check();
    }, this.checkInterval);
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Perform a single health check
   */
  async check(): Promise<HealthCheckResult> {
    const result = await checkHealth(this.options);
    const previousHealthy = this.lastResult?.healthy;
    this.lastResult = result;

    if (this.onHealthChange && previousHealthy !== result.healthy) {
      this.onHealthChange(result.healthy);
    }

    return result;
  }

  /**
   * Get the last health check result
   */
  getLastResult(): HealthCheckResult | null {
    return this.lastResult;
  }

  /**
   * Check if the service is currently healthy
   */
  isHealthy(): boolean {
    return this.lastResult?.healthy ?? false;
  }
}
