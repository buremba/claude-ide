import { chromium, Browser, BrowserContext, Page, LaunchOptions } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { BrowserConfig } from "./config.js";
import { ensureExtensions } from "./extension-manager.js";
import { writeBookmarks } from "./bookmark-manager.js";

/**
 * Get the default Chrome profile directory based on OS
 */
function getDefaultChromeProfile(): string | null {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "darwin") {
    return path.join(home, "Library/Application Support/Google Chrome/Default");
  } else if (platform === "win32") {
    return path.join(home, "AppData/Local/Google/Chrome/User Data/Default");
  } else if (platform === "linux") {
    return path.join(home, ".config/google-chrome/Default");
  }
  return null;
}

/**
 * Detect system color scheme (dark/light mode)
 */
function getSystemColorScheme(): "dark" | "light" {
  if (process.platform === "darwin") {
    // macOS: check AppleInterfaceStyle
    const result = spawnSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Returns "Dark" if dark mode, exits with error if light mode
    if (result.status === 0 && result.stdout?.trim() === "Dark") {
      return "dark";
    }
    return "light";
  } else if (process.platform === "win32") {
    // Windows: check registry for AppsUseLightTheme
    const result = spawnSync(
      "reg",
      ["query", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    if (result.status === 0 && result.stdout?.includes("0x0")) {
      return "dark";
    }
    return "light";
  }
  // Default to light for other platforms
  return "light";
}

export interface TabInfo {
  tabId: string;
  processName: string;
  url: string;
  title: string;
}

interface ProcessBrowserContext {
  context: BrowserContext;
  pages: Map<string, Page>; // tabId -> Page
  storageStatePath?: string;
  openUrls: Map<string, string>; // tabId -> url (for crash recovery)
}

interface BrowserManagerOptions {
  config: BrowserConfig;
  configDir: string;
}

type InitScriptTarget = {
  addInitScript: (script: (processName: string) => void, arg?: string) => Promise<void>;
};

/**
 * Manages a single Playwright browser instance with per-process contexts.
 * Handles auto-open, persistence, and crash recovery.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private persistentContext: BrowserContext | null = null;
  private contexts: Map<string, ProcessBrowserContext> = new Map();
  private config: BrowserConfig;
  private configDir: string;
  private resolvedStorageDir?: string;
  private resolvedUserDataDir?: string;
  private tabCounter = 0;
  private isShuttingDown = false;

  constructor(options: BrowserManagerOptions) {
    this.config = options.config;
    this.configDir = options.configDir;

    if (this.config.storageStateDir) {
      this.resolvedStorageDir = path.resolve(this.configDir, this.config.storageStateDir);
    }

    // Resolve user data directory
    if (this.config.userDataDir) {
      this.resolvedUserDataDir = path.resolve(this.configDir, this.config.userDataDir);
    } else {
      // Use temp dir with hash of configDir for uniqueness
      const hash = createHash("sha256").update(this.configDir).digest("hex").slice(0, 8);
      this.resolvedUserDataDir = path.join(os.tmpdir(), `mcp-sidecar-browser-${hash}`);
    }
  }

  /**
   * Copy essential profile files from source Chrome profile to destination
   */
  private async copyProfile(sourceDir: string, destDir: string): Promise<void> {
    if (!fs.existsSync(sourceDir)) {
      console.warn(`[BrowserManager] Source profile not found: ${sourceDir}`);
      return;
    }

    // Essential files for session/auth (skip cache, history, etc.)
    const filesToCopy = [
      "Cookies",
      "Login Data",
      "Preferences",
      "Local Storage",
      "Session Storage",
      "Web Data",
    ];

    fs.mkdirSync(destDir, { recursive: true });

    for (const file of filesToCopy) {
      const src = path.join(sourceDir, file);
      const dest = path.join(destDir, file);
      if (fs.existsSync(src)) {
        try {
          await fs.promises.cp(src, dest, { recursive: true });
        } catch (e) {
          // Some files might be locked, skip them
          console.warn(`[BrowserManager] Could not copy ${file}: ${e}`);
        }
      }
    }
  }

  private resolveProfilePath(profilePath: string): string {
    const expanded = profilePath.replace(/^~/, os.homedir());
    if (path.isAbsolute(expanded)) {
      return expanded;
    }
    return path.resolve(this.configDir, expanded);
  }

  private async addTitlePrefix(target: InitScriptTarget, processName: string): Promise<void> {
    await target.addInitScript((procName: string) => {
      const updateTitle = () => {
        const prefix = `MCP Sidecar [${procName}]`;
        if (!document.title.startsWith(prefix)) {
          const originalTitle = document.title || "New Tab";
          document.title = `${prefix} - ${originalTitle}`;
        }
      };

      // Initial title update
      updateTitle();

      // Watch for title changes
      const titleElement = document.querySelector("title");
      if (titleElement) {
        new MutationObserver(updateTitle).observe(titleElement, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }

      // Also watch for dynamic title element creation
      new MutationObserver(() => {
        const newTitle = document.querySelector("title");
        if (newTitle) {
          updateTitle();
          new MutationObserver(updateTitle).observe(newTitle, {
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
      }).observe(document.head || document.documentElement, {
        childList: true,
        subtree: true,
      });
    }, processName);
  }

  private getStorageStatePath(processName: string): string | undefined {
    if (!this.resolvedStorageDir || !this.config.persistByDefault) {
      return undefined;
    }
    return path.join(this.resolvedStorageDir, `${processName}.json`);
  }

  /**
   * Clean up legacy cached Chromium bundles from the old icon customization approach.
   * This can be removed after a few releases once users have upgraded.
   */
  private cleanupLegacyChromiumBundles(): void {
    const cacheDir = path.join(os.homedir(), ".cache", "mcp-sidecar", "chromium-bundles");
    if (fs.existsSync(cacheDir)) {
      try {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        console.error("[BrowserManager] Cleaned up legacy chromium-bundles cache");
      } catch {
        // Ignore cleanup errors - not critical
      }
    }
  }

  /**
   * Launch the browser (lazy - called on first use or explicitly)
   */
  async launch(): Promise<void> {
    if (this.browser) return;

    // One-time cleanup of legacy cached Chromium bundles
    this.cleanupLegacyChromiumBundles();

    if (!this.resolvedUserDataDir) {
      throw new Error("No user data directory available for browser profile");
    }

    // Handle profile copying if configured (for persistent context)
    const copyProfileFrom = this.config.copyProfileFrom ?? "auto";
    if (copyProfileFrom !== null) {
      // Only copy if user data dir doesn't exist yet
      if (!fs.existsSync(this.resolvedUserDataDir)) {
        let sourceProfile: string | null = null;

        if (copyProfileFrom === "auto") {
          // Auto-detect default Chrome profile
          sourceProfile = getDefaultChromeProfile();
        } else {
          // Use specified path (expand ~ and resolve relative paths)
          sourceProfile = this.resolveProfilePath(copyProfileFrom);
        }

        if (sourceProfile) {
          console.error(`[BrowserManager] Copying Chrome profile from ${sourceProfile}`);
          await this.copyProfile(sourceProfile, this.resolvedUserDataDir);
        } else {
          console.warn("[BrowserManager] No Chrome profile detected for auto-copy");
        }
      }
    }

    // Use launchPersistentContext for persistent profile
    // Note: This creates a single context tied to the profile
    console.error(`[BrowserManager] Launching with persistent context: ${this.resolvedUserDataDir}`);

    // Write bookmarks before launch if configured
    if (this.config.bookmarks && this.config.bookmarks.length > 0) {
      writeBookmarks(this.resolvedUserDataDir, this.config.bookmarks);
    }

    // Write enterprise policies to disable sign-in and profile features
    this.writeBrowserPolicies(this.resolvedUserDataDir);

    // Detect system color scheme for proper theme support
    const colorScheme = getSystemColorScheme();
    console.error(`[BrowserManager] Detected system color scheme: ${colorScheme}`);

    // Build launch options based on customization config
    const launchOptions = {
      headless: this.config.headless,
      colorScheme,
      args: [
        // Window behavior
        "--disable-session-crashed-bubble",  // Disable "restore" prompt
        "--disable-infobars",                 // Disable info bars
        "--hide-crash-restore-bubble",        // Hide crash restore bubble
        "--show-bookmarks-bar",               // Always show bookmarks bar
        "--no-startup-window",                // Don't open initial window (we'll create tabs explicitly)

        // Disable sign-in, sync, and profile management UI
        "--disable-sync",                     // Disable Chrome Sync
        "--no-first-run",                     // Disable first run experience
        "--disable-default-apps",             // Disable default apps
        "--disable-component-update",         // Disable component updates
        "--disable-background-networking",    // Disable background network requests

        // Hide the profile/identity button and disable sign-in
        "--disable-gaia-services",            // Disable Google account services
        "--disable-signin-frame-promo",       // Disable sign-in frame
        "--hide-sidepanel-button",
        "--disable-features=ChromeWhatsNewUI,SignInProfileCreation,ProfileMenuRevamp,ProfilePicker,Profiles,IdentityStatusOnProfileMenu,SignInPromoOnStartup,SyncPromo,ChromeSigninClient,BrowserSignin",

        // Additional flags
        "--profile-directory=Default",
        "--no-default-browser-check",
        "--ash-no-nudges",                    // Disable nudges/prompts
      ],
    };

    // Download and load extensions if configured
    if (this.config.extensions && this.config.extensions.length > 0) {
      const extensionPaths = await ensureExtensions(this.config.extensions);
      if (extensionPaths.length > 0) {
        const extensionList = extensionPaths.join(",");
        launchOptions.args!.push(`--load-extension=${extensionList}`);
        launchOptions.args!.push(`--disable-extensions-except=${extensionList}`);
      }
    }

    // Use Playwright's bundled Chromium directly (no custom icon/name)
    // Window titles are prefixed with process names for identification
    const persistentContext = await chromium.launchPersistentContext(this.resolvedUserDataDir, launchOptions);

    this.persistentContext = persistentContext;

    // Store the browser from the context
    this.browser = persistentContext.browser()!;

    // Close any windows restored from previous session
    const initialPages = persistentContext.pages();
    for (const page of initialPages) {
      try {
        await page.close();
      } catch {
        // Ignore errors
      }
    }

    // Note: Bookmarks bar visibility is handled via Preferences file in writeBookmarks()
    // The --show-bookmarks-bar flag is also passed in launch args
    // DO NOT use keyboard shortcut here as it TOGGLES the bar (would hide it if already showing)

    // Store this as a default context (will be used for all processes in persistent mode)
    this.contexts.set("__persistent__", {
      context: persistentContext,
      pages: new Map(),
      storageStatePath: undefined,
      openUrls: new Map(),
    });

    // Log when browser is closed (don't auto-restart - user can reopen manually)
    this.browser.on("disconnected", () => {
      if (!this.isShuttingDown) {
        console.error("[BrowserManager] Browser closed. Use browser_open to relaunch.");
        this.browser = null;
        this.persistentContext = null;
        this.contexts.clear();
      }
    });
  }

  /**
   * Activate browser window and bring to current Space (macOS only)
   */
  private activateBrowserWindow(): void {
    // Activate Playwright's Chromium browser
    const result = spawnSync("open", ["-a", "Chromium"], { stdio: "ignore" });
    if (result.status === 0) {
      console.error("[BrowserManager] Activated browser window");
    }
  }

  /**
   * Shutdown browser and all contexts
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Save storage state for persistent contexts
    for (const [processName, ctx] of this.contexts) {
      if (ctx.storageStatePath) {
        try {
          await this.saveStorageState(processName);
        } catch {
          // Ignore errors during shutdown
        }
      }
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.persistentContext = null;
    this.contexts.clear();
  }

  /**
   * Check if auto-open is enabled for a process
   */
  shouldAutoOpen(processName: string): boolean {
    const { autoOpen } = this.config;
    if (typeof autoOpen === "boolean") {
      return autoOpen;
    }
    return autoOpen.includes(processName);
  }

  /**
   * Get or create a browser context for a process
   */
  async getOrCreateContext(processName: string): Promise<BrowserContext> {
    await this.ensureBrowser();

    const existing = this.contexts.get(processName);
    if (existing) {
      return existing.context;
    }

    // Determine storage state path
    const storageStatePath = this.getStorageStatePath(processName);

    // Check if we're in persistent mode - use the single persistent context
    const persistentCtx = this.persistentContext;
    if (persistentCtx) {
      // In persistent mode, all processes share the same context
      // Map the process name to the persistent context
      this.contexts.set(processName, {
        context: persistentCtx,
        pages: new Map(),
        storageStatePath,
        openUrls: new Map(),
      });
      return persistentCtx;
    }

    let storageState: string | undefined;

    // Load existing state if available
    if (storageStatePath && fs.existsSync(storageStatePath)) {
      storageState = storageStatePath;
    }

    const context = await this.browser!.newContext({
      storageState,
    });

    // Inject window title prefix for all pages in this context
    await this.addTitlePrefix(context, processName);

    this.contexts.set(processName, {
      context,
      pages: new Map(),
      storageStatePath,
      openUrls: new Map(),
    });

    return context;
  }

  /**
   * Close a process's browser context
   */
  async closeContext(processName: string): Promise<void> {
    const ctx = this.contexts.get(processName);
    if (!ctx) return;

    // Save state before closing (if configured)
    if (ctx.storageStatePath) {
      await this.saveStorageState(processName);
    }

    if (this.persistentContext && ctx.context === this.persistentContext) {
      for (const page of ctx.pages.values()) {
        try {
          await page.close();
        } catch {
          // Ignore page close errors
        }
      }
      this.contexts.delete(processName);
      return;
    }

    await ctx.context.close();
    this.contexts.delete(processName);
  }

  /**
   * Open a new tab in the process's browser context
   */
  async openTab(processName: string, url: string): Promise<string> {
    const context = await this.getOrCreateContext(processName);
    const ctx = this.contexts.get(processName)!;

    // Check if there's already a tab with the same base URL for this process
    // (ignore query strings for comparison)
    const baseUrl = url.split("?")[0];
    for (const [existingTabId, existingPage] of ctx.pages) {
      const existingUrl = existingPage.url().split("?")[0];
      if (existingUrl === baseUrl || existingUrl.startsWith(baseUrl)) {
        // Tab already exists, just focus it
        await existingPage.bringToFront();
        return existingTabId;
      }
    }

    // Try to reuse an existing blank page instead of creating a new one
    let page = context.pages().find(p => {
      const pageUrl = p.url();
      return pageUrl === "about:blank" || pageUrl === "chrome://newtab/" || pageUrl === "";
    });

    if (!page) {
      page = await context.newPage();
    }

    if (this.persistentContext && context === this.persistentContext) {
      await this.addTitlePrefix(page, processName);
    }
    await page.goto(url);

    // Ensure title prefix is applied after page load
    await page.evaluate((procName) => {
      const prefix = `MCP Sidecar [${procName}]`;
      if (!document.title.startsWith(prefix)) {
        document.title = `${prefix} - ${document.title || "New Tab"}`;
      }
    }, processName);

    const tabId = `tab_${++this.tabCounter}`;
    ctx.pages.set(tabId, page);
    ctx.openUrls.set(tabId, url);

    // Bring to front
    await page.bringToFront();

    return tabId;
  }

  /**
   * Close a specific tab
   */
  async closeTab(processName: string, tabId: string): Promise<void> {
    const ctx = this.contexts.get(processName);
    if (!ctx) {
      throw new Error(`No browser context for process "${processName}"`);
    }

    const page = ctx.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab "${tabId}" not found in process "${processName}"`);
    }

    await page.close();
    ctx.pages.delete(tabId);
    ctx.openUrls.delete(tabId);
  }

  /**
   * Focus a specific tab
   */
  async focusTab(processName: string, tabId: string): Promise<void> {
    const ctx = this.contexts.get(processName);
    if (!ctx) {
      throw new Error(`No browser context for process "${processName}"`);
    }

    const page = ctx.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab "${tabId}" not found in process "${processName}"`);
    }

    await page.bringToFront();
  }

  /**
   * Reload a specific tab
   */
  async reloadTab(processName: string, tabId: string): Promise<void> {
    const ctx = this.contexts.get(processName);
    if (!ctx) {
      throw new Error(`No browser context for process "${processName}"`);
    }

    const page = ctx.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab "${tabId}" not found in process "${processName}"`);
    }

    await page.reload();
  }

  /**
   * Take a screenshot of a tab
   */
  async screenshot(processName: string, tabId: string): Promise<Buffer> {
    const ctx = this.contexts.get(processName);
    if (!ctx) {
      throw new Error(`No browser context for process "${processName}"`);
    }

    const page = ctx.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab "${tabId}" not found in process "${processName}"`);
    }

    return await page.screenshot();
  }

  /**
   * Execute JavaScript in a tab
   */
  async evaluate(processName: string, tabId: string, script: string): Promise<unknown> {
    const ctx = this.contexts.get(processName);
    if (!ctx) {
      throw new Error(`No browser context for process "${processName}"`);
    }

    const page = ctx.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab "${tabId}" not found in process "${processName}"`);
    }

    return await page.evaluate(script);
  }

  /**
   * List all open tabs
   */
  async listTabs(processName?: string): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];

    const processesToList = processName
      ? [[processName, this.contexts.get(processName)] as const]
      : Array.from(this.contexts.entries());

    for (const [name, ctx] of processesToList) {
      if (!ctx) continue;

      for (const [tabId, page] of ctx.pages) {
        try {
          tabs.push({
            tabId,
            processName: name,
            url: page.url(),
            title: await page.title(),
          });
        } catch {
          // Page might be closed
        }
      }
    }

    return tabs;
  }

  /**
   * Save storage state for a process
   */
  async saveStorageState(processName: string): Promise<void> {
    const ctx = this.contexts.get(processName);
    if (!ctx) {
      throw new Error(`No browser context for process "${processName}"`);
    }

    if (!this.resolvedStorageDir) {
      throw new Error("No storageStateDir configured");
    }

    // Ensure directory exists
    fs.mkdirSync(this.resolvedStorageDir, { recursive: true });

    const storagePath = path.join(this.resolvedStorageDir, `${processName}.json`);
    await ctx.context.storageState({ path: storagePath });
    ctx.storageStatePath = storagePath;
  }

  /**
   * Load storage state for a process (creates context if needed)
   */
  async loadStorageState(processName: string): Promise<void> {
    if (this.persistentContext) {
      throw new Error("Storage state loading is not supported with a persistent browser profile");
    }

    if (!this.resolvedStorageDir) {
      throw new Error("No storageStateDir configured");
    }

    const storagePath = path.join(this.resolvedStorageDir, `${processName}.json`);
    if (!fs.existsSync(storagePath)) {
      throw new Error(`No saved storage state for process "${processName}"`);
    }

    // Close existing context if any
    await this.closeContext(processName);

    // Recreate with storage state
    await this.ensureBrowser();
    const context = await this.browser!.newContext({
      storageState: storagePath,
    });

    this.contexts.set(processName, {
      context,
      pages: new Map(),
      storageStatePath: storagePath,
      openUrls: new Map(),
    });
  }

  private async ensureBrowser(): Promise<void> {
    if (!this.browser) {
      await this.launch();
    }
  }

  /**
   * Write enterprise policies to disable sign-in and profile UI
   * Chromium reads policies from {userData}/policies/managed/
   */
  private writeBrowserPolicies(userDataDir: string): void {
    const policiesDir = path.join(userDataDir, "policies", "managed");
    fs.mkdirSync(policiesDir, { recursive: true });

    const policies = {
      // Disable browser sign-in
      BrowserSignin: 0,
      // Disable sync
      SyncDisabled: true,
      // Disable profile creation/management
      BrowserAddPersonEnabled: false,
      BrowserGuestModeEnabled: false,
      // Disable the profile picker on startup
      BrowserThemeColor: "#1a1a2e",  // Set a theme color (optional)
      // Disable various prompts
      PromotionalTabsEnabled: false,
      ShowHomeButton: false,
    };

    const policyFile = path.join(policiesDir, "mcp_sidecar_policies.json");
    fs.writeFileSync(policyFile, JSON.stringify(policies, null, 2));
    console.error("[BrowserManager] Wrote browser policies to disable sign-in UI");
  }
}
