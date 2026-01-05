import { watch, FSWatcher } from "chokidar";
import * as path from "path";
import { Config, loadConfig } from "./config.js";

export interface ConfigWatcherEvents {
  onConfigChange: (config: Config) => void;
  onError?: (error: Error) => void;
}

/**
 * Watches sidecar.yaml for changes and triggers reload
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private configPath: string;
  private events: ConfigWatcherEvents;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs = 300; // Debounce rapid changes

  constructor(configPath: string, events: ConfigWatcherEvents) {
    this.configPath = path.resolve(configPath);
    this.events = events;
  }

  /**
   * Start watching the config file
   */
  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    this.watcher = watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", () => this.handleChange());
    this.watcher.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.events.onError?.(err);
    });

    console.error(`[sidecar] Watching ${this.configPath} for changes`);
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Handle config file change with debouncing
   */
  private handleChange(): void {
    // Debounce rapid changes (e.g., editor save + format)
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      await this.reloadConfig();
    }, this.debounceMs);
  }

  /**
   * Reload and validate config
   */
  private async reloadConfig(): Promise<void> {
    try {
      console.error("[sidecar] Config file changed, reloading...");
      const { config } = await loadConfig(this.configPath);
      this.events.onConfigChange(config);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[sidecar] Failed to reload config: ${err.message}`);
      this.events.onError?.(err);
    }
  }
}
