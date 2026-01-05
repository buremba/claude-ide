# Investigation: Browser UI and Launch Behavior

## Problems Investigated

1. **Profile Button**: The MCP Sidecar browser shows a profile/identity button in the toolbar - can we hide it?
2. **Focus Stealing**: Browser launch steals focus from user's current application - can we prevent this?

## Key Findings

- **Profile button cannot be reliably hidden** without losing tabs (App Mode)
- **Profile button is harmless** - Chrome sign-in doesn't affect webapp sessions
- **Focus stealing can be prevented** with CDP approach, but at cost of reliability
- **Reliability is prioritized** over preventing focus stealing

## Current State
- Browser launches using Playwright's bundled Chromium (window titles prefixed with process names for identification)
- Various flags and policies have been tried but the profile button persists
- Session data persistence is required (no incognito mode)

---

## Test Results (2026-01-05)

### Approaches Tested

| Approach | Profile Button Hidden? | Notes |
|----------|----------------------|-------|
| App Mode (`--app=URL`) | **YES** | Clean minimal UI, no address bar, no tabs |
| Field Trials (`--force-fieldtrials`) | **NO** | Profile button visible with sign-in popup |
| Combined Flags | **NO** | Profile button still visible |
| Normal Mode | **NO** | Profile button visible (baseline) |

### 1. App Mode - WORKS but has trade-offs

```bash
chromium --app=http://localhost:3000 --user-data-dir=/tmp/test
```

**Result**: Profile button hidden

**Pros**:
- No profile button
- No address bar (cleaner UI)
- Sessions persist (uses same user data dir)
- Multiple windows can be opened side-by-side

**Cons**:
- No tabs (each URL = separate window)
- No address bar (can't manually navigate)
- No bookmarks bar
- Clicking dock icon opens new Chrome window (not app mode window)

### 2. Field Trials - DOES NOT WORK

```bash
chromium --force-fieldtrials=AvatarButton/Disabled/ http://localhost:3000
```

**Result**: Profile button still visible. Sign-in popup appeared on first launch.

### 3. Combined Flags - DOES NOT WORK

```bash
chromium --user-data-dir=/tmp/test \
  --no-first-run \
  --disable-sync \
  --disable-gaia-services \
  --disable-features=SignInProfileCreation,ProfileMenuRevamp,ProfilePicker,Profiles,BrowserSignin,IdentityStatusOnProfileMenu \
  --force-fieldtrials=AvatarButton/Disabled/ \
  http://localhost:3000
```

**Result**: Profile button still visible.

### 4. Enterprise Policies - DOES NOT WORK

Written to `{userData}/policies/managed/policy.json`:
```json
{
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "BrowserAddPersonEnabled": false,
  "BrowserGuestModeEnabled": false
}
```

**Result**: Profile button still visible.

---

## Chrome Sign-in Analysis

**Key Finding**: Chrome sign-in is SEPARATE from webapp sessions.

| Concern | Reality |
|---------|---------|
| User signs into Chrome profile | Only affects Google sync (bookmarks, passwords), NOT webapp sessions |
| User restarts browser | Webapp sessions persist (stored in user-data-dir) |
| User clicks profile button | Nothing breaks, just cosmetic annoyance |

### Session Storage Locations

Webapp sessions are stored locally in the `user-data-dir`:
- **Cookies**: `{user-data-dir}/Default/Cookies`
- **localStorage**: `{user-data-dir}/Default/Local Storage/leveldb`

These persist across browser restarts regardless of Chrome sign-in status.

### Conclusion

**Accepting the profile button is a viable option** - it's cosmetic noise that doesn't affect webapp functionality or session persistence.

---

## Background Screenshot Solution

### Problem
Taking screenshots without stealing focus from the user's current application.

### Solution That Works

**Step 1**: Launch Chromium in background using macOS `open -g` flag:

```bash
CHROMIUM="/path/to/Google Chrome for Testing.app"
open -g -a "$CHROMIUM" --args \
  --user-data-dir=/path/to/data \
  --no-first-run \
  --remote-debugging-port=9222 \
  http://localhost:3000
```

**Step 2**: Connect via CDP and screenshot:

```typescript
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0]?.pages()[0];
await page.screenshot({ path: 'screenshot.png' });
await browser.close();
```

### Implementation in TypeScript

Use `spawn` for safe process launching:

```typescript
import { spawn } from 'child_process';
import { chromium } from 'playwright';

// Launch Chromium in background (macOS)
function launchBrowserBackground(chromiumAppPath: string, userDataDir: string, url: string, port = 9222) {
  const args = [
    '-g',  // background flag
    '-a', chromiumAppPath,
    '--args',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    url
  ];

  spawn('open', args, { detached: true, stdio: 'ignore' });
}

// Take screenshot via CDP
async function screenshotViaCDP(port = 9222, outputPath: string) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: outputPath });
  }
  await browser.close();
}
```

### Approaches That Don't Work

| Approach | Problem |
|----------|---------|
| `screencapture -x` | Captures whole screen, needs window visible |
| `screencapture -l<windowID>` | Flaky, window must be on screen |
| Playwright `launch()` | Always steals focus |
| Playwright `launchPersistentContext()` | Always steals focus |

### Key Insight

- `open -g` = macOS flag to open app in background (no focus steal)
- `--remote-debugging-port=9222` = enables CDP connection
- `chromium.connectOverCDP()` = connects to existing browser without launching new one
- `page.screenshot()` = captures page content without needing focus

---

## Final Recommendations

### Current Approach: `launchPersistentContext()` (Recommended)

**Keep using Playwright's `launchPersistentContext()` for reliability.**

```typescript
// Current reliable approach
const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
```

**Why:**
- Battle-tested and reliable
- Full Playwright lifecycle control
- Built-in persistent context support
- Cross-platform (macOS, Windows, Linux)
- Simpler error handling

**Tradeoff:** Browser steals focus on launch. This is acceptable for reliability.

### Profile Button Decision

**Accept the Profile Button (Recommended)**
- Profile button exists but is harmless
- Full tab support
- Address bar for navigation
- Sessions persist in user-data-dir
- Chrome sign-in doesn't affect webapp sessions

### Alternative: CDP Approach (Not Recommended)

The `open -g` + CDP approach can prevent focus stealing but has significant tradeoffs:

| Aspect | launchPersistentContext | open -g + CDP |
|--------|------------------------|---------------|
| Reliability | **High** | Medium |
| Focus stealing | Yes | No |
| Cross-platform | **Yes** | macOS only |
| Complexity | **Simple** | Complex |
| Port conflicts | None | Must handle |

**Conclusion:** Reliability > No focus stealing. Keep current approach.

---

## Test Commands

```bash
# Get Playwright's Chromium path
CHROMIUM=$(node -e "const {chromium} = require('playwright'); console.log(chromium.executablePath())")

# Test App Mode (hides profile button)
"$CHROMIUM" --user-data-dir=/tmp/test-app --app=http://localhost:3000

# Test Normal Mode (profile button visible)
"$CHROMIUM" --user-data-dir=/tmp/test-normal --no-first-run http://localhost:3000

# Test Background Launch + CDP Screenshot
CHROMIUM_APP="/Users/burakemre/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app"
open -g -a "$CHROMIUM_APP" --args --user-data-dir=/tmp/test-bg --no-first-run --remote-debugging-port=9222 http://localhost:3000
# Then connect via: chromium.connectOverCDP('http://localhost:9222')
```

---

## Files to Modify (if implementing changes)

- `src/browser-manager.ts` - Add `open -g` launch method and CDP connection
- `src/screenshot.ts` (if exists) - Use CDP-based screenshot approach
