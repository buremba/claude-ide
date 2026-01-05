#!/usr/bin/env node
/**
 * Test script for BrowserManager
 * Run: node test-browser.js
 */

import { BrowserManager } from '../../dist/browser-manager.js';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const configDir = new URL('.', import.meta.url).pathname;

async function main() {
  console.log('=== Browser Manager Test ===\n');

  // Start the demo server
  console.log('1. Starting demo server...');
  const server = spawn('node', ['server.cjs'], {
    cwd: configDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3456' }
  });

  server.stdout.on('data', (data) => console.log(`   [server] ${data.toString().trim()}`));
  server.stderr.on('data', (data) => console.error(`   [server] ${data.toString().trim()}`));

  // Wait for server to start
  await setTimeout(1000);

  // Create browser manager
  console.log('\n2. Creating BrowserManager...');
  const browserManager = new BrowserManager({
    config: {
      enabled: true,
      headless: true,  // Use headless for automated testing
      autoOpen: true,
      persistByDefault: false,
      copyProfileFrom: null,  // Fresh browser (no Chrome profile copy)
    },
    configDir,
  });

  try {
    // Test: Launch browser
    console.log('\n3. Launching browser...');
    await browserManager.launch();
    console.log('   Browser launched successfully');

    // Test: Open tab
    console.log('\n4. Opening tab...');
    const tabId = await browserManager.openTab('demo-server', 'http://localhost:3456');
    console.log(`   Opened tab: ${tabId}`);

    // Test: List tabs
    console.log('\n5. Listing tabs...');
    const tabs = await browserManager.listTabs();
    console.log(`   Found ${tabs.length} tab(s):`);
    for (const tab of tabs) {
      console.log(`   - ${tab.tabId}: ${tab.url} (${tab.title})`);
    }

    // Test: Evaluate JS and check title prefix
    console.log('\n6. Evaluating JavaScript...');
    const title = await browserManager.evaluate('demo-server', tabId, 'document.title');
    console.log(`   Page title: ${title}`);

    if (title.startsWith('MCP Sidecar [demo-server]')) {
      console.log('   Title prefix is correctly injected!');
    } else {
      console.log('   WARNING: Title prefix not found');
    }

    const counter = await browserManager.evaluate('demo-server', tabId,
      'document.getElementById("counter").textContent');
    console.log(`   Counter value: ${counter}`);

    // Test: Increment counter
    console.log('\n7. Clicking increment button...');
    await browserManager.evaluate('demo-server', tabId,
      'document.querySelector("button").click()');
    const newCounter = await browserManager.evaluate('demo-server', tabId,
      'document.getElementById("counter").textContent');
    console.log(`   Counter after click: ${newCounter}`);

    // Test: Screenshot
    console.log('\n8. Taking screenshot...');
    const screenshot = await browserManager.screenshot('demo-server', tabId);
    console.log(`   Screenshot size: ${screenshot.length} bytes`);

    // Test: Open second tab (shared profile test)
    console.log('\n9. Testing shared profile...');
    const tabId2 = await browserManager.openTab('other-process', 'http://localhost:3456');
    console.log(`   Opened second tab in different context: ${tabId2}`);

    // Set localStorage in first context
    await browserManager.evaluate('demo-server', tabId,
      'localStorage.setItem("test", "from-demo-server")');
    const val1 = await browserManager.evaluate('demo-server', tabId,
      'localStorage.getItem("test")');
    console.log(`   demo-server localStorage: ${val1}`);

    // Check localStorage in second context (should be shared)
    const val2 = await browserManager.evaluate('other-process', tabId2,
      'localStorage.getItem("test")');
    console.log(`   other-process localStorage: ${val2}`);

    if (val2 === 'from-demo-server') {
      console.log('   Shared profile is working!');
    } else {
      console.log('   WARNING: Shared profile not detected');
    }

    // Test: Close tab
    console.log('\n10. Closing tabs...');
    await browserManager.closeTab('demo-server', tabId);
    await browserManager.closeTab('other-process', tabId2);
    console.log('    Tabs closed');

    // Test: Shutdown
    console.log('\n11. Shutting down browser...');
    await browserManager.shutdown();
    console.log('    Browser shut down');

    console.log('\n=== All tests passed! ===\n');
  } catch (err) {
    console.error('\nTest failed:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup
    server.kill();
    await browserManager.shutdown().catch(() => {});
  }
}

main();
