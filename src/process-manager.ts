import { EventEmitter } from "events";
import { Config, ProcessConfig, ResolvedProcessConfig, resolveProcessConfigs, sortByDependencies, Settings } from "./config.js";
import { ManagedProcess, ProcessState, StartOptions, ProcessSettings } from "./process.js";
import { EnvContext } from "./env-resolver.js";
import { TmuxManager } from "./tmux-manager.js";

// Deep compare two process configs (ignoring computed fields)
function configsEqual(a: ProcessConfig, b: ProcessConfig): boolean {
  return (
    a.command === b.command &&
    a.cwd === b.cwd &&
    a.port === b.port &&
    a.autoStart === b.autoStart &&
    JSON.stringify(a.stdoutPatternVars ?? {}) === JSON.stringify(b.stdoutPatternVars ?? {}) &&
    JSON.stringify(a.readyVars ?? []) === JSON.stringify(b.readyVars ?? []) &&
    a.envFile === b.envFile &&
    a.restartPolicy === b.restartPolicy &&
    a.maxRestarts === b.maxRestarts &&
    a.healthCheck === b.healthCheck &&
    a.dependsOn === b.dependsOn &&
    JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {})
  );
}

export interface ProcessManagerEvents {
  onProcessReady?: (name: string) => void;
  onProcessCrash?: (name: string, exitCode: number | null) => void;
  onLog?: (name: string, line: string, stream: "stdout" | "stderr") => void;
  onHealthChange?: (name: string, healthy: boolean) => void;
}

export interface ProcessManagerOptions {
  events?: ProcessManagerEvents;
  settings?: Settings;
  tmuxManager: TmuxManager;
}

/**
 * Manages all background processes
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private processConfigs = new Map<string, ResolvedProcessConfig>();
  private events: ProcessManagerEvents;
  private configDir: string;
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private currentConfig: Config | null = null;
  private envContext: EnvContext | null = null;
  private dependencyTimeout: number;
  private processSettings: ProcessSettings;
  private restartBackoffMax: number;

  // Tmux manager (required)
  private tmuxManager: TmuxManager;
  private tmuxPollInterval: NodeJS.Timeout | null = null;
  private tmuxPollRate = 500; // Fast polling during startup
  private tmuxSlowPollRate = 3000; // Slow polling after ready

  constructor(configDir: string, options: ProcessManagerOptions) {
    super();
    this.configDir = configDir;
    this.events = options.events ?? {};
    this.tmuxManager = options.tmuxManager;

    // Apply settings from config or use defaults
    const settings = options.settings;
    this.dependencyTimeout = settings?.dependencyTimeout ?? 60000;
    this.restartBackoffMax = settings?.restartBackoffMax ?? 30000;
    this.processSettings = {
      logBufferSize: settings?.logBufferSize ?? 1000,
      healthCheckInterval: settings?.healthCheckInterval ?? 10000,
      restartBackoffMax: settings?.restartBackoffMax ?? 30000,
      processStopTimeout: settings?.processStopTimeout ?? 5000,
    };
  }

  /**
   * Get the tmux session name
   */
  get tmuxSessionName(): string {
    return this.tmuxManager.sessionName;
  }

  /**
   * Initialize and start all processes from config
   */
  async startAll(config: Config): Promise<void> {
    this.currentConfig = config;

    // Resolve and sort processes
    const resolved = resolveProcessConfigs(config, this.configDir);
    const sorted = sortByDependencies(resolved);

    // Build port map for processes with fixed ports (for env var interpolation)
    const portMap = new Map<string, number>();
    const exportMap = new Map<string, Record<string, string>>();
    for (const processConfig of sorted) {
      if (processConfig.port) {
        portMap.set(processConfig.name, processConfig.port);
        exportMap.set(processConfig.name, { port: String(processConfig.port) });
      }
    }

    // Create env context
    const envContext: EnvContext = {
      processPorts: portMap,
      processExports: exportMap,
      systemEnv: process.env,
    };
    this.envContext = envContext;

    this.processes.clear();
    this.processConfigs.clear();

    // Register all processes
    for (const processConfig of sorted) {
      this.registerProcess(processConfig, envContext, portMap);
    }

    // Start auto-start processes in dependency order
    for (const processConfig of sorted) {
      const blockReason = this.getAutoStartBlockReason(processConfig);
      if (blockReason) {
        console.error(`[sidecar] Not auto-starting "${processConfig.name}" (${blockReason})`);
        continue;
      }
      await this.startManagedProcess(processConfig);
    }

    // Start tmux polling for status updates
    this.startTmuxPolling();
  }

  /**
   * Register a process without starting it
   */
  private registerProcess(
    processConfig: ResolvedProcessConfig,
    envContext: EnvContext,
    portMap: Map<string, number>
  ): ManagedProcess {
    const managedProcess = new ManagedProcess(
      processConfig,
      this.configDir,
      {
        onReady: (p) => {
          // Update port map when port is detected
          if (p.port) {
            portMap.set(p.name, p.port);
          }
          this.events.onProcessReady?.(p.name);
          // Emit event for dependency waiting
          this.emit("processReady", p.name);
          // Adjust poll rate once processes are ready
          this.adjustTmuxPollRate();
        },
        onCrash: (p, exitCode) => {
          this.events.onProcessCrash?.(p.name, exitCode);
          // Emit event for dependency waiting (in case something is waiting)
          this.emit("processFailed", p.name, exitCode);
          this.handleCrash(p.name, processConfig);
        },
        onLog: (p, line, stream) => {
          this.events.onLog?.(p.name, line, stream);
        },
        onHealthChange: (p, healthy) => {
          this.events.onHealthChange?.(p.name, healthy);
        },
      },
      this.processSettings,
      this.tmuxManager
    );

    // Set env context for variable interpolation
    managedProcess.setEnvContext({
      ...envContext,
      currentPort: processConfig.port,
    });

    this.processes.set(processConfig.name, managedProcess);
    this.processConfigs.set(processConfig.name, processConfig);

    return managedProcess;
  }

  /**
   * Start a registered process
   */
  private async startManagedProcess(
    processConfig: ResolvedProcessConfig,
    options?: StartOptions
  ): Promise<void> {
    if (!this.envContext) {
      throw new Error("Environment context not initialized");
    }

    const managedProcess = this.processes.get(processConfig.name);
    if (!managedProcess) {
      throw new Error(`Process "${processConfig.name}" not found`);
    }

    // Wait for all dependencies (supports multiple dependencies)
    if (processConfig.dependsOn && processConfig.dependsOn.length > 0) {
      // Check if any dependency is autoStart=false and not ready
      for (const depName of processConfig.dependsOn) {
        const dependencyConfig = this.processConfigs.get(depName);
        const dependency = this.processes.get(depName);
        if (dependencyConfig?.autoStart === false && !dependency?.isReady) {
          throw new Error(
            `Process "${processConfig.name}" depends on "${depName}" which is not started`
          );
        }
      }

      // Wait for all dependencies in parallel
      await Promise.all(
        processConfig.dependsOn.map((depName) => this.waitForReady(depName))
      );
    }

    managedProcess.setEnvContext({
      ...this.envContext,
      currentPort: processConfig.port,
    });

    await managedProcess.start(options);
  }

  private shouldAutoStart(processConfig: ResolvedProcessConfig): boolean {
    return !this.getAutoStartBlockReason(processConfig);
  }

  private getAutoStartBlockReason(processConfig: ResolvedProcessConfig): string | null {
    if (processConfig.autoStart === false) {
      return "autoStart=false";
    }

    // Check all dependencies for autoStart=false
    if (processConfig.dependsOn) {
      for (const depName of processConfig.dependsOn) {
        const dependencyConfig = this.processConfigs.get(depName);
        if (dependencyConfig?.autoStart === false) {
          return `dependsOn "${depName}" which is autoStart=false`;
        }
      }
    }

    return null;
  }

  /**
   * Reload config and apply changes (stop removed, start added, restart changed)
   */
  async reload(newConfig: Config): Promise<{ added: string[]; removed: string[]; changed: string[] }> {
    const oldProcessNames = new Set(this.processConfigs.keys());
    const newProcessNames = new Set(Object.keys(newConfig.processes));

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    // Find removed processes
    for (const name of oldProcessNames) {
      if (!newProcessNames.has(name)) {
        removed.push(name);
      }
    }

    // Find added and changed processes
    for (const [name, newProcessConfig] of Object.entries(newConfig.processes)) {
      if (!oldProcessNames.has(name)) {
        added.push(name);
      } else {
        const oldConfig = this.processConfigs.get(name);
        if (oldConfig && !configsEqual(oldConfig, newProcessConfig)) {
          changed.push(name);
        }
      }
    }

    // Stop removed processes
    for (const name of removed) {
      console.error(`[sidecar] Stopping removed process "${name}"`);
      const process = this.processes.get(name);
      if (process) {
        await process.stop();
        this.processes.delete(name);
        this.processConfigs.delete(name);
      }
      // Clear any restart timer
      const timer = this.restartTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.restartTimers.delete(name);
      }
    }

    // Restart changed processes
    for (const name of changed) {
      console.error(`[sidecar] Restarting changed process "${name}"`);
      const process = this.processes.get(name);
      if (process) {
        await process.stop();
        this.processes.delete(name);
        this.processConfigs.delete(name);
      }
      const timer = this.restartTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.restartTimers.delete(name);
      }
    }

    // Update config
    this.currentConfig = newConfig;

    // Resolve new configs
    const resolved = resolveProcessConfigs(newConfig, this.configDir);
    const sorted = sortByDependencies(resolved);

    // Build port map
    const portMap = new Map<string, number>();
    const exportMap = new Map<string, Record<string, string>>();
    for (const pc of sorted) {
      if (pc.port) {
        portMap.set(pc.name, pc.port);
      }
      // Include existing running process ports
      const existing = this.processes.get(pc.name);
      if (existing?.port) {
        portMap.set(pc.name, existing.port);
      }

      const existingExports = existing?.exports;
      if (existingExports) {
        exportMap.set(pc.name, existingExports);
      } else if (pc.port) {
        exportMap.set(pc.name, { port: String(pc.port) });
      }
    }

    const envContext: EnvContext = {
      processPorts: portMap,
      processExports: exportMap,
      systemEnv: process.env,
    };
    this.envContext = envContext;

    // Register added/changed processes and update env context for existing ones
    for (const processConfig of sorted) {
      if (added.includes(processConfig.name) || changed.includes(processConfig.name)) {
        this.registerProcess(processConfig, envContext, portMap);
      } else {
        const existing = this.processes.get(processConfig.name);
        if (existing) {
          existing.setEnvContext({
            ...envContext,
            currentPort: processConfig.port,
          });
        }
        this.processConfigs.set(processConfig.name, processConfig);
      }
    }

    // Start added and changed processes (in dependency order)
    for (const processConfig of sorted) {
      if (added.includes(processConfig.name) || changed.includes(processConfig.name)) {
        const blockReason = this.getAutoStartBlockReason(processConfig);
        if (blockReason) {
          console.error(`[sidecar] Not auto-starting "${processConfig.name}" (${blockReason})`);
          continue;
        }
        console.error(`[sidecar] Starting process "${processConfig.name}"`);
        await this.startManagedProcess(processConfig);
      }
    }

    // Update status after reload

    return { added, removed, changed };
  }

  /**
   * Wait for a process to be ready using events (no polling)
   */
  private waitForReady(name: string, timeout?: number): Promise<void> {
    const timeoutMs = timeout ?? this.dependencyTimeout;

    return new Promise((resolve, reject) => {
      const process = this.processes.get(name);
      if (!process) {
        reject(new Error(`Process "${name}" not found`));
        return;
      }

      if (process.isReady) {
        resolve();
        return;
      }

      // Check if already failed
      if (process.status === "crashed" || process.status === "stopped") {
        reject(new Error(`Process "${name}" crashed or stopped while waiting`));
        return;
      }

      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        this.off("processReady", onReady);
        this.off("processFailed", onFailed);
        clearTimeout(timer);
      };

      const onReady = (readyName: string) => {
        if (readyName === name) {
          cleanup();
          resolve();
        }
      };

      const onFailed = (failedName: string) => {
        if (failedName === name) {
          cleanup();
          reject(new Error(`Process "${name}" crashed or stopped while waiting`));
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for process "${name}" to be ready (${timeoutMs}ms)`));
      }, timeoutMs);

      this.on("processReady", onReady);
      this.on("processFailed", onFailed);
    });
  }

  /**
   * Handle a process crash/exit based on restartPolicy
   * - "always": restart on any exit (with exponential backoff)
   * - "onFailure": restart only on non-zero exit
   * - "never": don't restart
   */
  private handleCrash(name: string, config: ResolvedProcessConfig): void {
    const process = this.processes.get(name);
    if (!process) return;

    const exitCode = process.getState().exitCode;
    const shouldRestart = this.shouldRestart(config.restartPolicy, exitCode);

    if (shouldRestart && process.restartCount < config.maxRestarts) {
      // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at configurable max
      const delay = Math.min(Math.pow(2, process.restartCount) * 1000, this.restartBackoffMax);

      // Clear any existing restart timer
      const existingTimer = this.restartTimers.get(name);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      console.error(`[sidecar] Process "${name}" exited (code=${exitCode}), restarting in ${delay}ms (attempt ${process.restartCount + 1}/${config.maxRestarts})`);

      // Schedule restart
      const timer = setTimeout(async () => {
        this.restartTimers.delete(name);
        try {
          await process.restart();
        } catch (err) {
          console.error(`Failed to restart process "${name}":`, err);
        }
      }, delay);

      this.restartTimers.set(name, timer);
    } else if (shouldRestart) {
      console.error(`[sidecar] Process "${name}" exceeded max restarts (${config.maxRestarts}), giving up`);
    }
  }

  /**
   * Determine if a process should restart based on policy and exit code
   */
  private shouldRestart(policy: string, exitCode: number | undefined): boolean {
    switch (policy) {
      case "always":
        return true;
      case "onFailure":
        return exitCode !== 0;
      case "never":
        return false;
      default:
        return false;
    }
  }

  /**
   * Stop all processes
   */
  async stopAll(): Promise<void> {
    // Stop tmux polling
    this.stopTmuxPolling();

    // Clear all restart timers
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();

    // Stop all processes in parallel
    const stopPromises = Array.from(this.processes.values()).map((p) => p.stop());
    await Promise.all(stopPromises);

    // Destroy the tmux session
    await this.tmuxManager.destroySession();
  }

  /**
   * Start a process by name (optionally with extra args/env)
   */
  async startProcess(name: string, options?: StartOptions): Promise<void> {
    const config = this.processConfigs.get(name);
    if (!config) {
      throw new Error(`Process "${name}" not found`);
    }

    if (!this.envContext) {
      throw new Error("Environment context not initialized");
    }

    let process = this.processes.get(name);
    if (!process) {
      process = this.registerProcess(config, this.envContext, this.envContext.processPorts);
    }

    if (process.status === "running" || process.status === "ready" || process.status === "starting") {
      throw new Error(`Process "${name}" is already running`);
    }

    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }

    await this.startManagedProcess(config, options);
  }

  /**
   * Restart a process only if it is currently running
   */
  async restartIfRunning(name: string): Promise<boolean> {
    const process = this.processes.get(name);
    if (!process) {
      return false;
    }

    if (process.status === "running" || process.status === "ready" || process.status === "starting") {
      const timer = this.restartTimers.get(name);
      if (timer) {
        clearTimeout(timer);
        this.restartTimers.delete(name);
      }
      await process.restart();
      return true;
    }

    return false;
  }

  /**
   * Get a process by name
   */
  getProcess(name: string): ManagedProcess | undefined {
    return this.processes.get(name);
  }

  /**
   * List all processes
   */
  listProcesses(): ProcessState[] {
    return Array.from(this.processes.values()).map((p) => p.getState());
  }

  /**
   * Get logs for a process
   */
  getLogs(name: string, stream: "stdout" | "stderr" | "combined" = "combined", tail?: number): string[] {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    return process.getLogs(stream, tail);
  }

  /**
   * Get URL for a process
   */
  getUrl(name: string): string | undefined {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    return process.url;
  }

  /**
   * Restart a process
   */
  async restartProcess(name: string): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }
    await process.restart();
  }

  /**
   * Stop a process permanently (until manually started again)
   */
  async stopProcess(name: string): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }

    // Clear any pending restart timer
    const timer = this.restartTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(name);
    }

    // Stop the process
    await process.stop();

    // Update status
  }

  /**
   * Get status of a process
   */
  getStatus(name: string): ProcessState {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }
    return process.getState();
  }

  /**
   * Get all process names
   */
  getProcessNames(): string[] {
    return Array.from(this.processes.keys());
  }

  // ============================================
  // Tmux polling methods
  // ============================================

  /**
   * Start tmux status polling
   */
  private startTmuxPolling(): void {
    if (this.tmuxPollInterval) return;

    const poll = async () => {
      await this.pollTmuxProcesses();
    };

    // Start with fast polling
    this.tmuxPollInterval = setInterval(poll, this.tmuxPollRate);
    // Run immediately
    poll();
  }

  /**
   * Stop tmux status polling
   */
  private stopTmuxPolling(): void {
    if (this.tmuxPollInterval) {
      clearInterval(this.tmuxPollInterval);
      this.tmuxPollInterval = null;
    }
  }

  /**
   * Adjust poll rate based on process readiness
   * Fast polling during startup, slow polling once stable
   */
  private adjustTmuxPollRate(): void {
    if (!this.tmuxPollInterval) return;

    // Check if all processes are ready or stable
    const allReady = Array.from(this.processes.values()).every(
      (p) => p.isReady || p.status === "stopped" || p.status === "crashed" || p.status === "completed"
    );

    if (allReady) {
      // Switch to slow polling
      this.stopTmuxPolling();
      this.tmuxPollInterval = setInterval(() => this.pollTmuxProcesses(), this.tmuxSlowPollRate);
    }
  }

  /**
   * Poll all tmux processes for status updates
   */
  private async pollTmuxProcesses(): Promise<void> {
    for (const [, process] of this.processes) {
      // Only poll running processes
      if (process.status === "running" || process.status === "starting" || process.status === "ready") {
        await process.pollTmuxStatus();
      }
    }
  }
}
