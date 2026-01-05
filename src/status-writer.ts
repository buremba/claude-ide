import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { ProcessState } from "./process.js";

export interface StatusFileContent {
  version: 1;
  projectId: string;
  updatedAt: string;
  processes: StatusProcessEntry[];
}

export interface StatusProcessEntry {
  name: string;
  port?: number;
  status: string;
  healthy?: boolean;
  error?: string;
}

export interface StatusWriterOptions {
  enabled: boolean;
  filePath?: string;
}

/**
 * Writes process status to a JSON file for the statusline to read.
 * Uses debouncing to avoid excessive writes during rapid state changes.
 */
export class StatusWriter {
  private filePath: string;
  private enabled: boolean;
  private writeTimer: NodeJS.Timeout | null = null;
  private pendingWrite = false;
  private pendingData: ProcessState[] = [];
  private debounceMs = 100;

  constructor(configDir: string, options: StatusWriterOptions) {
    this.enabled = options.enabled;

    if (options.filePath) {
      this.filePath = options.filePath;
    } else {
      // Generate project-specific filename using hash of configDir
      // Use os.tmpdir() for cross-platform compatibility
      const projectId = this.hashPath(configDir).slice(0, 8);
      this.filePath = path.join(os.tmpdir(), `mcp-sidecar-status-${projectId}.json`);
    }
  }

  private hashPath(p: string): string {
    return crypto.createHash("sha256").update(p).digest("hex");
  }

  /**
   * Write status to file (debounced)
   */
  write(processes: ProcessState[]): void {
    if (!this.enabled) return;

    this.pendingWrite = true;
    this.pendingData = processes;

    if (this.writeTimer) return; // Already scheduled

    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        this.doWrite(this.pendingData);
      }
    }, this.debounceMs);
  }

  private doWrite(processes: ProcessState[]): void {
    const projectId = this.filePath.match(/status-([a-f0-9]+)\.json$/)?.[1] ?? "unknown";

    const content: StatusFileContent = {
      version: 1,
      projectId,
      updatedAt: new Date().toISOString(),
      processes: processes.map((p) => ({
        name: p.name,
        port: p.port,
        status: p.status,
        healthy: p.healthy,
        error: p.error,
      })),
    };

    try {
      // Atomic write: write to temp file, then rename
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(content, null, 2));
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      // Ignore write errors (e.g., permission issues)
      console.error(`[sidecar] Failed to write status file: ${err}`);
    }
  }

  /**
   * Remove status file on shutdown
   */
  cleanup(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Get the status file path (for logging/debugging)
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Check if status writing is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
