const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function test() {
  const userDataDir = '/tmp/mcp-sidecar-test-' + Date.now();

  // Write bookmarks before launch
  const bookmarksPath = path.join(userDataDir, 'Bookmarks');
  fs.mkdirSync(userDataDir, { recursive: true });

  const bookmarksData = {
    checksum: "",
    roots: {
      bookmark_bar: {
        children: [
          { id: "1", name: "Demo Server", type: "url", url: "http://localhost:3000", date_added: "0", guid: "test1" },
          { id: "2", name: "Google", type: "url", url: "https://google.com", date_added: "0", guid: "test2" }
        ],
        id: "0",
        name: "Bookmarks bar",
        type: "folder",
        date_added: "0",
        guid: "root"
      },
      other: { children: [], id: "3", name: "Other", type: "folder", date_added: "0", guid: "other" },
      synced: { children: [], id: "4", name: "Mobile", type: "folder", date_added: "0", guid: "synced" }
    },
    version: 1
  };
  fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarksData, null, 2));
  console.log('Bookmarks written to:', bookmarksPath);

  // Check if extension is cached
  const extensionPath = path.join(process.env.HOME, '.cache/mcp-sidecar/extensions/fmkadmapgofadopljbjfkapdkoienihi');
  const hasExtension = fs.existsSync(extensionPath);
  console.log('Extension cached:', hasExtension, extensionPath);

  // Launch browser
  const args = ['--disable-session-crashed-bubble'];
  if (hasExtension) {
    args.push(`--load-extension=${extensionPath}`);
    args.push(`--disable-extensions-except=${extensionPath}`);
  }

  console.log('Launching browser...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);

  // Take screenshot
  const screenshotPath = '/tmp/browser-features-test.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  // Check for extension
  const extensions = await page.evaluate(() => {
    return typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined';
  });
  console.log('React DevTools hook present:', extensions);

  await context.close();
  console.log('Test complete!');
}

test().catch(console.error);
