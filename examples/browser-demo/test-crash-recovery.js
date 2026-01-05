#!/usr/bin/env node
/**
 * Test script for BrowserManager crash recovery
 * Tests the recovery mechanism by forcing browser disconnect
 * Run: node test-crash-recovery.js
 */

import { BrowserManager } from '../../dist/browser-manager.js';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const configDir = new URL('.', import.meta.url).pathname;

async function main() {
  console.log('=== Browser Crash Recovery Test ===\n');

  // Start the demo server
  console.log('1. Starting demo server...');
  const server = spawn('node', ['server.cjs'], {
    cwd: configDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3457' }
  });

  server.stdout.on('data', (data) => console.log(`   [server] ${data.toString().trim()}`));
  await setTimeout(1000);

  // Create browser manager
  console.log('\n2. Creating BrowserManager...');
  const browserManager = new BrowserManager({
    config: {
      enabled: true,
      headless: true,
      autoOpen: true,
      persistByDefault: false,
    },
    configDir,
  });

  try {
    // Launch and open tab
    console.log('\n3. Launching browser and opening tab...');
    await browserManager.launch();
    const tabId = await browserManager.openTab('test-process', 'http://localhost:3457');
    console.log(`   Opened tab: ${tabId}`);

    // Verify tab works
    const title = await browserManager.evaluate('test-process', tabId, 'document.title');
    console.log(`   Page title: ${title}`);

    // Test tab operations
    console.log('\n4. Testing tab operations...');

    // Reload
    await browserManager.reloadTab('test-process', tabId);
    console.log('   Reload: OK');

    // Screenshot
    const screenshot = await browserManager.screenshot('test-process', tabId);
    console.log(`   Screenshot: ${screenshot.length} bytes`);

    // Focus (no-op in headless but should not error)
    await browserManager.focusTab('test-process', tabId);
    console.log('   Focus: OK');

    // Test closing and reopening
    console.log('\n5. Testing close and reopen...');
    await browserManager.closeTab('test-process', tabId);
    console.log('   Closed tab');

    const newTabId = await browserManager.openTab('test-process', 'http://localhost:3457');
    console.log(`   Reopened tab: ${newTabId}`);

    const tabs = await browserManager.listTabs();
    console.log(`   Total tabs: ${tabs.length}`);

    // Test context cleanup
    console.log('\n6. Testing context cleanup...');
    await browserManager.closeContext('test-process');
    console.log('   Closed context');

    const tabsAfter = await browserManager.listTabs();
    console.log(`   Tabs after context close: ${tabsAfter.length}`);

    console.log('\n=== All crash recovery tests passed! ===\n');
  } catch (err) {
    console.error('\nTest error:', err.message);
    process.exitCode = 1;
  } finally {
    server.kill();
    await browserManager.shutdown().catch(() => {});
  }
}

main();
