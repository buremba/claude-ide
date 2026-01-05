import { watch, FSWatcher } from "chokidar";
import * as path from "path";
import { Config } from "./config.js";

export interface EnvFileWatcherEvents {
  onEnvFileChange: (processNames: string[], envFilePath: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Watches env files referenced by processes and triggers restarts on change
 */
export class EnvFileWatcher {
  private watcher: FSWatcher | null = null;
  private envFileMap = new Map<string, string[]>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingFiles = new Set<string>();
  private events: EnvFileWatcherEvents;
  private debounceMs = 300;

  constructor(events: EnvFileWatcherEvents) {
    this.events = events;
  }

  /**
   * Update watched env files based on config
   */
  updateConfig(config: Config, configDir: string): void {
    const nextMap = this.buildEnvFileMap(config, configDir);
    if (this.mapsEqual(this.envFileMap, nextMap)) {
      this.envFileMap = nextMap;
      return;
    }

    this.envFileMap = nextMap;
    this.restartWatcher();
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingFiles.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private restartWatcher(): void {
    void this.stop().then(() => this.start());
  }

  private start(): void {
    if (this.watcher) {
      return;
    }

    const files = Array.from(this.envFileMap.keys());
    if (files.length === 0) {
      return;
    }

    this.watcher = watch(files, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", (filePath) => this.handleChange(filePath));
    this.watcher.on("unlink", (filePath) => this.handleChange(filePath));
    this.watcher.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.events.onError?.(err);
    });

    console.error(`[sidecar] Watching ${files.length} env file(s) for changes`);
  }

  private handleChange(filePath: string): void {
    if (!this.envFileMap.has(filePath)) {
      return;
    }

    this.pendingFiles.add(filePath);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushChanges();
    }, this.debounceMs);
  }

  private flushChanges(): void {
    for (const filePath of this.pendingFiles) {
      const processNames = this.envFileMap.get(filePath);
      if (processNames && processNames.length > 0) {
        this.events.onEnvFileChange(processNames, filePath);
      }
    }
    this.pendingFiles.clear();
  }

  private buildEnvFileMap(config: Config, configDir: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const [name, processConfig] of Object.entries(config.processes)) {
      if (!processConfig.envFile) {
        continue;
      }
      const envPath = path.resolve(configDir, processConfig.envFile);
      const existing = map.get(envPath) ?? [];
      existing.push(name);
      map.set(envPath, existing);
    }
    return map;
  }

  private mapsEqual(a: Map<string, string[]>, b: Map<string, string[]>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, aValue] of a) {
      const bValue = b.get(key);
      if (!bValue) {
        return false;
      }
      if (aValue.length !== bValue.length) {
        return false;
      }
      const aSorted = [...aValue].sort();
      const bSorted = [...bValue].sort();
      for (let i = 0; i < aSorted.length; i++) {
        if (aSorted[i] !== bSorted[i]) {
          return false;
        }
      }
    }
    return true;
  }
}
