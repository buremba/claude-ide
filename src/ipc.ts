import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash, randomUUID } from "crypto";
import { z } from "zod";

export type IpcEndpoint =
  | { kind: "unix"; path: string }
  | { kind: "pipe"; path: string };

// Schema for validating IPC requests
const IpcRequestSchema = z.object({
  id: z.string().min(1).max(100),
  method: z.string().min(1).max(100),
  params: z.unknown().optional(),
});

export interface IpcRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface IpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type IpcHandler = (method: string, params?: unknown) => Promise<unknown>;

// IPC server configuration
const IPC_CONFIG = {
  maxConnections: 50,
  maxRequestSize: 1024 * 1024, // 1MB max request size
  connectionTimeout: 30000, // 30s idle timeout
};

export function getIpcEndpoint(configDir: string, reuseKey?: string): IpcEndpoint {
  const realDir = fs.realpathSync(configDir);
  const identity = reuseKey ? `${realDir}:${reuseKey}` : realDir;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  if (process.platform === "win32") {
    return { kind: "pipe", path: `\\\\.\\pipe\\mcp-sidecar-${hash}` };
  }
  // Use os.tmpdir() for cross-platform compatibility
  const base = os.tmpdir();
  return { kind: "unix", path: path.join(base, `mcp-sidecar-${hash}.sock`) };
}

export function isAddrInUse(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "EADDRINUSE";
}

export function isMissing(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

export async function canConnect(endpoint: IpcEndpoint, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint.path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function startIpcServer(endpoint: IpcEndpoint, handler: IpcHandler): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    let activeConnections = 0;

    const server = net.createServer((socket) => {
      // Enforce connection limits
      if (activeConnections >= IPC_CONFIG.maxConnections) {
        socket.end();
        return;
      }
      activeConnections++;

      let buffer = "";
      let bufferSize = 0;

      // Set idle timeout
      socket.setTimeout(IPC_CONFIG.connectionTimeout);
      socket.on("timeout", () => {
        socket.destroy();
      });

      socket.on("close", () => {
        activeConnections--;
      });

      socket.on("error", () => {
        // Silently handle socket errors
        activeConnections--;
      });

      socket.on("data", async (data) => {
        bufferSize += data.length;

        // Enforce max request size
        if (bufferSize > IPC_CONFIG.maxRequestSize) {
          const response: IpcResponse = {
            id: "unknown",
            ok: false,
            error: "Request too large",
          };
          socket.write(`${JSON.stringify(response)}\n`);
          socket.destroy();
          return;
        }

        buffer += data.toString();
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          bufferSize = buffer.length;
          idx = buffer.indexOf("\n");
          if (!line) {
            continue;
          }

          let request: IpcRequest;
          try {
            const parsed = JSON.parse(line);
            // Validate request schema
            request = IpcRequestSchema.parse(parsed);
          } catch (err) {
            const response: IpcResponse = {
              id: "unknown",
              ok: false,
              error: `Invalid request: ${err instanceof Error ? err.message : String(err)}`,
            };
            socket.write(`${JSON.stringify(response)}\n`);
            continue;
          }

          try {
            const result = await handler(request.method, request.params);
            const response: IpcResponse = { id: request.id, ok: true, result };
            socket.write(`${JSON.stringify(response)}\n`);
          } catch (err) {
            const response: IpcResponse = {
              id: request.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
            socket.write(`${JSON.stringify(response)}\n`);
          }
        }
      });
    });

    // Set max connections on the server
    server.maxConnections = IPC_CONFIG.maxConnections;

    server.on("error", (err) => reject(err));
    server.listen(endpoint.path, () => resolve(server));
  });
}

export async function callIpc(
  endpoint: IpcEndpoint,
  method: string,
  params?: unknown,
  timeoutMs = 5000
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.path);
    const id = randomUUID();
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("IPC call timed out"));
    }, timeoutMs);

    socket.on("connect", () => {
      const request: IpcRequest = { id, method, params };
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on("data", (data) => {
      buffer += data.toString();
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          const response = JSON.parse(line) as IpcResponse;
          if (response.id === id) {
            clearTimeout(timer);
            socket.end();
            resolve(response);
          }
        } catch {
          // Ignore malformed responses
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function cleanupIpcEndpoint(endpoint: IpcEndpoint): void {
  if (endpoint.kind === "unix" && fs.existsSync(endpoint.path)) {
    try {
      fs.unlinkSync(endpoint.path);
    } catch {
      // Ignore cleanup errors
    }
  }
}
