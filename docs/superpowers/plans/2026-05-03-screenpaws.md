# ScreenPaws Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ScreenPaws Chrome extension (MV3) that forces breaks with a full-screen cat overlay, per the design at `docs/superpowers/specs/2026-05-03-screenpaws-design.md`.

**Architecture:** Service worker owns timer + state (chrome.alarms, chrome.storage.local). Content script renders an opaque full-screen overlay on every tab during break. Popup is a thin client that reads/writes state via messages.

**Tech Stack:** Chrome Extension MV3 · Vanilla HTML/CSS/JS · `chrome.alarms` · `chrome.storage.local` · `chrome.notifications` · `chrome.runtime` · `chrome.tabs` (no permission needed).

**Note on testing:** Per the spec, this project has no automated tests — Chrome extension test infra is heavy and not justified here. Each task includes a **manual verification** step that the implementer must run in a real Chrome window. Reload the extension at `chrome://extensions/` after every code change.

**Dev convenience:** All durations are stored in *minutes* but the popup only exposes preset values. To exercise full cycles in seconds, override storage directly from the service worker DevTools console:
```js
chrome.storage.local.set({ state: { workMin: 10/60, breakMin: 3/60, phase: "working", phaseStartTs: Date.now(), pausedRemainingMs: null } });
chrome.alarms.clearAll(); chrome.alarms.create("transition", { when: Date.now() + 10000 });
```

---

### Task 1: Project skeleton + manifest

**Files:**
- Create: `screenpaws/manifest.json`
- Create: `screenpaws/background.js` (stub)
- Create: `screenpaws/content.js` (stub)
- Create: `screenpaws/content.css` (stub)
- Create: `screenpaws/popup.html` (stub)
- Create: `screenpaws/popup.js` (stub)
- Create: `screenpaws/popup.css` (stub)

- [ ] **Step 1: Create `screenpaws/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "ScreenPaws",
  "version": "0.1.0",
  "description": "Forces you to take breaks with a cute cat overlay.",
  "permissions": ["storage", "alarms", "notifications"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle",
    "all_frames": false
  }],
  "web_accessible_resources": [{
    "resources": ["assets/cat.webp"],
    "matches": ["<all_urls>"]
  }]
}
```

(Icons intentionally omitted; added in Task 11.)

- [ ] **Step 2: Create stub `screenpaws/background.js`**

```js
console.log("[ScreenPaws] background.js loaded");
```

- [ ] **Step 3: Create stub `screenpaws/content.js`**

```js
console.log("[ScreenPaws] content.js loaded on", location.href);
```

- [ ] **Step 4: Create stub `screenpaws/content.css`**

```css
/* ScreenPaws overlay styles — populated in Task 7 */
```

- [ ] **Step 5: Create stub `screenpaws/popup.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="popup.css"></head>
<body><p>ScreenPaws</p><script src="popup.js"></script></body></html>
```

- [ ] **Step 6: Create stub `screenpaws/popup.js`**

```js
console.log("[ScreenPaws] popup.js loaded");
```

- [ ] **Step 7: Create stub `screenpaws/popup.css`**

```css
body { font-family: system-ui, sans-serif; padding: 12px; min-width: 240px; }
```

- [ ] **Step 8: Manual verification — load unpacked**

1. Open `chrome://extensions/`.
2. Toggle "Developer mode" on (top right).
3. Click "Load unpacked" and select `C:\Users\nsand\OneDrive\Desktop\p1\screenpaws`.
4. Expected: ScreenPaws appears in the list with no errors. Click "service worker" link → DevTools opens → console shows `[ScreenPaws] background.js loaded`.
5. Open any web page (e.g. https://example.com). Open DevTools → console shows `[ScreenPaws] content.js loaded on https://example.com/`.
6. Click the puzzle-piece icon → pin ScreenPaws → click its icon → popup opens with "ScreenPaws" text.

- [ ] **Step 9: Commit**

```bash
git add screenpaws/
git commit -m "feat(screenpaws): scaffold MV3 extension with stubs"
```

---

### Task 2: Storage layer in background.js

**Files:**
- Modify: `screenpaws/background.js` (replace stub)

- [ ] **Step 1: Replace `screenpaws/background.js` with the storage helpers and defaults**

```js
// ScreenPaws — service worker
// State is persisted in chrome.storage.local under key "state".

const STORAGE_KEY = "state";

const DEFAULT_STATE = {
  workMin: 60,
  breakMin: 5,
  phase: "working",        // "working" | "break" | "paused"
  phaseStartTs: Date.now(),
  pausedRemainingMs: null
};

async function loadState() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] ?? { ...DEFAULT_STATE, phaseStartTs: Date.now() };
  } catch (e) {
    console.error("[ScreenPaws] loadState failed, using defaults:", e);
    return { ...DEFAULT_STATE, phaseStartTs: Date.now() };
  }
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function phaseDurationMs(state) {
  if (state.phase === "working") return state.workMin * 60_000;
  if (state.phase === "break") return state.breakMin * 60_000;
  return 0;
}

function remainingMs(state) {
  if (state.phase === "paused") return state.pausedRemainingMs ?? 0;
  const elapsed = Date.now() - state.phaseStartTs;
  return Math.max(0, phaseDurationMs(state) - elapsed);
}

console.log("[ScreenPaws] background.js loaded");
```

- [ ] **Step 2: Manual verification — storage round-trip**

1. Reload the extension at `chrome://extensions/` (click the refresh icon on the ScreenPaws card).
2. Open the service worker DevTools console.
3. Run `await loadState()` → should return an object matching DEFAULT_STATE shape.
4. Run `await saveState({ ...await loadState(), workMin: 42 })`.
5. Run `await loadState()` → `workMin` should be 42.
6. Run `await chrome.storage.local.clear()` to reset.

- [ ] **Step 3: Commit**

```bash
git add screenpaws/background.js
git commit -m "feat(screenpaws): add storage layer and state defaults"
```

---

### Task 3: Alarm-driven phase transitions

**Files:**
- Modify: `screenpaws/background.js` (append)

- [ ] **Step 1: Append the alarm scheduler and transition handler to `screenpaws/background.js`**

Add the following block at the end of the file:

```js
const ALARM_NAME = "phase-transition";

async function scheduleTransition(state) {
  await chrome.alarms.clear(ALARM_NAME);
  if (state.phase === "paused") return;
  const fireAt = state.phaseStartTs + phaseDurationMs(state);
  await chrome.alarms.create(ALARM_NAME, { when: Math.max(fireAt, Date.now() + 100) });
  console.log(`[ScreenPaws] alarm scheduled for ${new Date(fireAt).toISOString()} (phase=${state.phase})`);
}

async function transitionToBreak() {
  const prev = await loadState();
  const next = {
    ...prev,
    phase: "break",
    phaseStartTs: Date.now(),
    pausedRemainingMs: null
  };
  await saveState(next);
  await scheduleTransition(next);
  // Broadcast + notification added in Task 5.
  console.log("[ScreenPaws] -> break");
  return next;
}

async function transitionToWorking() {
  const prev = await loadState();
  const next = {
    ...prev,
    phase: "working",
    phaseStartTs: Date.now(),
    pausedRemainingMs: null
  };
  await saveState(next);
  await scheduleTransition(next);
  // Broadcast added in Task 5.
  console.log("[ScreenPaws] -> working");
  return next;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const state = await loadState();
  if (state.phase === "working") await transitionToBreak();
  else if (state.phase === "break") await transitionToWorking();
});
```

- [ ] **Step 2: Manual verification — alarm fires transition**

1. Reload the extension.
2. Open the service worker DevTools console.
3. Run:
   ```js
   await chrome.storage.local.set({ state: { workMin: 5/60, breakMin: 5/60, phase: "working", phaseStartTs: Date.now(), pausedRemainingMs: null } });
   await scheduleTransition(await loadState());
   ```
4. Wait ~5 seconds. Console should log `[ScreenPaws] -> break`.
5. Wait another ~5 seconds. Console should log `[ScreenPaws] -> working`.
6. Run `await chrome.storage.local.clear()` to reset.

- [ ] **Step 3: Commit**

```bash
git add screenpaws/background.js
git commit -m "feat(screenpaws): alarm-driven phase transitions"
```

---

### Task 4: Lifecycle hooks (onStartup, onInstalled, recovery on wake)

**Files:**
- Modify: `screenpaws/background.js` (append)

- [ ] **Step 1: Append lifecycle initializer to `screenpaws/background.js`**

```js
async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  let state = stored[STORAGE_KEY];

  if (!state) {
    // First run.
    state = { ...DEFAULT_STATE, phaseStartTs: Date.now() };
    await saveState(state);
    await scheduleTransition(state);
    console.log("[ScreenPaws] init: fresh state");
    return;
  }

  // Recovery: did the alarm time pass while the worker was asleep?
  if (state.phase !== "paused" && remainingMs(state) <= 0) {
    if (state.phase === "working") await transitionToBreak();
    else await transitionToWorking();
    console.log("[ScreenPaws] init: recovered from missed transition");
    return;
  }

  // Re-arm alarm in case it was lost.
  await scheduleTransition(state);
  console.log(`[ScreenPaws] init: resumed phase=${state.phase} remaining=${Math.round(remainingMs(state)/1000)}s`);
}

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
```

- [ ] **Step 2: Manual verification — fresh install starts working timer**

1. At `chrome://extensions/`, click "Remove" on ScreenPaws, then "Load unpacked" again.
2. Service worker console should log `[ScreenPaws] init: fresh state` and an `alarm scheduled` line ~60 minutes out.
3. Run `await loadState()` → `phase === "working"`, `phaseStartTs` near `Date.now()`.

- [ ] **Step 3: Manual verification — recovery from missed transition**

1. In the service worker console:
   ```js
   await chrome.storage.local.set({ state: { workMin: 1, breakMin: 1, phase: "working", phaseStartTs: Date.now() - 120_000, pausedRemainingMs: null } });
   ```
   (This sets phase to "working" 2 minutes ago with a 1-minute work duration → already expired.)
2. Reload the extension (forces `init` via `onInstalled`).
3. Console should log `[ScreenPaws] init: recovered from missed transition` and `[ScreenPaws] -> break`.
4. Reset: `await chrome.storage.local.clear()` then reload extension.

- [ ] **Step 4: Commit**

```bash
git add screenpaws/background.js
git commit -m "feat(screenpaws): lifecycle hooks with sleep recovery"
```

---

### Task 5: Broadcast to tabs + notification on break start

**Files:**
- Modify: `screenpaws/background.js` (modify `transitionToBreak` / `transitionToWorking`, append helpers)

- [ ] **Step 1: Append broadcast + notification helpers to `screenpaws/background.js`**

```js
async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // Restricted page or no content script — expected, ignore.
    });
  }
}

async function fireBreakNotification(breakMin) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/cat.webp"),
      title: "휴식 시간이에요 🐱",
      message: `${breakMin}분간 쉬어요`,
      priority: 2
    });
  } catch (e) {
    console.error("[ScreenPaws] notification failed:", e);
  }
}
```

- [ ] **Step 2: Replace `transitionToBreak` in `screenpaws/background.js`**

Find the existing `transitionToBreak` function and replace it with:

```js
async function transitionToBreak() {
  const prev = await loadState();
  const next = {
    ...prev,
    phase: "break",
    phaseStartTs: Date.now(),
    pausedRemainingMs: null
  };
  await saveState(next);
  await scheduleTransition(next);
  const breakEndTs = next.phaseStartTs + phaseDurationMs(next);
  await broadcastToTabs({ type: "BREAK_START", endTs: breakEndTs });
  await fireBreakNotification(next.breakMin);
  console.log("[ScreenPaws] -> break");
  return next;
}
```

- [ ] **Step 3: Replace `transitionToWorking` in `screenpaws/background.js`**

```js
async function transitionToWorking() {
  const prev = await loadState();
  const next = {
    ...prev,
    phase: "working",
    phaseStartTs: Date.now(),
    pausedRemainingMs: null
  };
  await saveState(next);
  await scheduleTransition(next);
  await broadcastToTabs({ type: "BREAK_END" });
  console.log("[ScreenPaws] -> working");
  return next;
}
```

- [ ] **Step 4: Update `screenpaws/content.js` to log received messages (for verification)**

Replace stub with:

```js
console.log("[ScreenPaws] content.js loaded on", location.href);

chrome.runtime.onMessage.addListener((msg) => {
  console.log("[ScreenPaws] message received:", msg);
});
```

- [ ] **Step 5: Manual verification — broadcast + notification fire**

1. Reload the extension.
2. Open https://example.com in two tabs. Open DevTools on each.
3. In service worker console:
   ```js
   await transitionToBreak();
   ```
4. Both example.com tabs' consoles should log `[ScreenPaws] message received: {type: "BREAK_START", endTs: ...}`.
5. A system notification should appear with the cat icon and Korean text. (If Windows blocks the notification, check Settings → System → Notifications and ensure Chrome is permitted.)
6. In service worker console: `await transitionToWorking();` → tabs log `BREAK_END`.

- [ ] **Step 6: Commit**

```bash
git add screenpaws/background.js screenpaws/content.js
git commit -m "feat(screenpaws): broadcast phase to tabs and notify on break"
```

---

### Task 6: Background message handlers (popup commands)

**Files:**
- Modify: `screenpaws/background.js` (append)

- [ ] **Step 1: Append the message router to `screenpaws/background.js`**

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const state = await loadState();
      switch (msg?.type) {
        case "GET_STATE": {
          sendResponse({
            phase: state.phase,
            remainingSec: Math.round(remainingMs(state) / 1000),
            workMin: state.workMin,
            breakMin: state.breakMin,
            breakEndTs: state.phase === "break"
              ? state.phaseStartTs + phaseDurationMs(state)
              : null
          });
          return;
        }
        case "UPDATE_SETTINGS": {
          const next = { ...state };
          if (typeof msg.workMin === "number") next.workMin = msg.workMin;
          if (typeof msg.breakMin === "number") next.breakMin = msg.breakMin;
          // If currently in the affected phase, restart it from now.
          if ((state.phase === "working" && typeof msg.workMin === "number") ||
              (state.phase === "break" && typeof msg.breakMin === "number")) {
            next.phaseStartTs = Date.now();
          }
          await saveState(next);
          await scheduleTransition(next);
          sendResponse({ ok: true });
          return;
        }
        case "PAUSE": {
          if (state.phase !== "working") {
            sendResponse({ ok: false, error: "Can only pause during working phase" });
            return;
          }
          const next = {
            ...state,
            phase: "paused",
            pausedRemainingMs: remainingMs(state)
          };
          await saveState(next);
          await chrome.alarms.clear(ALARM_NAME);
          sendResponse({ ok: true });
          return;
        }
        case "RESUME": {
          if (state.phase !== "paused") {
            sendResponse({ ok: false, error: "Not paused" });
            return;
          }
          const remaining = state.pausedRemainingMs ?? 0;
          const next = {
            ...state,
            phase: "working",
            phaseStartTs: Date.now() - (state.workMin * 60_000 - remaining),
            pausedRemainingMs: null
          };
          await saveState(next);
          await scheduleTransition(next);
          sendResponse({ ok: true });
          return;
        }
        case "START_BREAK_NOW": {
          await transitionToBreak();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      console.error("[ScreenPaws] message handler error:", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep sendResponse async
});
```

- [ ] **Step 2: Manual verification — exercise each command from popup console**

1. Reload the extension. Open popup, then right-click inside the popup → Inspect → DevTools console for the popup.
2. Run:
   ```js
   await chrome.runtime.sendMessage({ type: "GET_STATE" });
   // Expected: { phase: "working", remainingSec: ~3600, workMin: 60, breakMin: 5, breakEndTs: null }
   ```
3. ```js
   await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", workMin: 30 });
   await chrome.runtime.sendMessage({ type: "GET_STATE" });
   // Expected: workMin: 30, remainingSec: ~1800
   ```
4. ```js
   await chrome.runtime.sendMessage({ type: "PAUSE" });
   await chrome.runtime.sendMessage({ type: "GET_STATE" });
   // Expected: phase: "paused"
   await chrome.runtime.sendMessage({ type: "RESUME" });
   await chrome.runtime.sendMessage({ type: "GET_STATE" });
   // Expected: phase: "working", remainingSec close to before pause
   ```
5. ```js
   await chrome.runtime.sendMessage({ type: "START_BREAK_NOW" });
   // Expected: phase becomes "break"; service worker console logs `-> break`; notification fires.
   ```
6. Reset: `await chrome.storage.local.clear()` then reload extension.

- [ ] **Step 3: Commit**

```bash
git add screenpaws/background.js
git commit -m "feat(screenpaws): popup command message handlers"
```

---

### Task 7: Content script — overlay rendering, countdown, key blocking

**Files:**
- Modify: `screenpaws/content.js` (replace)
- Modify: `screenpaws/content.css` (replace)

- [ ] **Step 1: Replace `screenpaws/content.css`**

```css
.screenpaws-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: #1a1a1a;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  user-select: none;
  cursor: not-allowed;
}

.screenpaws-overlay__cat {
  max-width: 60vmin;
  max-height: 60vmin;
  margin-bottom: 32px;
  pointer-events: none;
  user-select: none;
}

.screenpaws-overlay__countdown {
  color: #ffffff;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}

.screenpaws-overlay__label {
  color: #cccccc;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 18px;
  margin-top: 16px;
}
```

- [ ] **Step 2: Replace `screenpaws/content.js`**

```js
// ScreenPaws — content script
// Renders an opaque full-screen overlay during break phase.

const OVERLAY_ID = "screenpaws-overlay-root";
let overlayEl = null;
let countdownTimerId = null;
let keyBlockerHandler = null;

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function blockKey(e) {
  // Don't block typical accessibility keys we can't intercept anyway (Alt+F4, Win key).
  // Block Escape, F11, Tab, common shortcuts.
  e.preventDefault();
  e.stopPropagation();
}

function showOverlay(endTs) {
  if (overlayEl) return; // already showing

  overlayEl = document.createElement("div");
  overlayEl.id = OVERLAY_ID;
  overlayEl.className = "screenpaws-overlay";

  const img = document.createElement("img");
  img.className = "screenpaws-overlay__cat";
  img.src = chrome.runtime.getURL("assets/cat.webp");
  img.alt = "Resting cat";

  const countdown = document.createElement("div");
  countdown.className = "screenpaws-overlay__countdown";
  countdown.textContent = formatRemaining(endTs - Date.now());

  const label = document.createElement("div");
  label.className = "screenpaws-overlay__label";
  label.textContent = "휴식 시간이에요";

  overlayEl.appendChild(img);
  overlayEl.appendChild(countdown);
  overlayEl.appendChild(label);
  document.documentElement.appendChild(overlayEl);

  countdownTimerId = setInterval(() => {
    const remainingMs = endTs - Date.now();
    if (remainingMs <= 0) {
      countdown.textContent = "00:00";
      // Background will broadcast BREAK_END which calls hideOverlay.
      return;
    }
    countdown.textContent = formatRemaining(remainingMs);
  }, 250);

  keyBlockerHandler = blockKey;
  window.addEventListener("keydown", keyBlockerHandler, true);
  window.addEventListener("keyup", keyBlockerHandler, true);
  window.addEventListener("keypress", keyBlockerHandler, true);
}

function hideOverlay() {
  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
  if (keyBlockerHandler) {
    window.removeEventListener("keydown", keyBlockerHandler, true);
    window.removeEventListener("keyup", keyBlockerHandler, true);
    window.removeEventListener("keypress", keyBlockerHandler, true);
    keyBlockerHandler = null;
  }
  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "BREAK_START" && typeof msg.endTs === "number") {
    showOverlay(msg.endTs);
  } else if (msg?.type === "BREAK_END") {
    hideOverlay();
  }
});

console.log("[ScreenPaws] content.js loaded on", location.href);
```

- [ ] **Step 3: Manual verification — overlay shows and dismisses**

1. Reload the extension.
2. Open https://example.com.
3. In the service worker console:
   ```js
   await chrome.storage.local.set({ state: { workMin: 60, breakMin: 5/60, phase: "working", phaseStartTs: Date.now(), pausedRemainingMs: null } });
   await transitionToBreak();
   ```
4. Expected on the example.com tab: full-screen dark overlay with cat image and `00:05` countdown ticking down.
5. Try pressing Escape — overlay should not dismiss. Try clicking — nothing happens.
6. After 5 seconds the alarm fires `transitionToWorking` → overlay disappears.
7. Reset: `await chrome.storage.local.clear()` then reload extension.

- [ ] **Step 4: Commit**

```bash
git add screenpaws/content.js screenpaws/content.css
git commit -m "feat(screenpaws): full-screen break overlay with countdown"
```

---

### Task 8: Content script — initial state query (handle pages loaded mid-break)

**Files:**
- Modify: `screenpaws/content.js` (append)

- [ ] **Step 1: Append the initial state query to `screenpaws/content.js`**

Add the following at the end of the file:

```js
// On load, ask background for current state — if a break is in progress,
// render the overlay immediately (handles tabs opened during break).
(async () => {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (state?.phase === "break" && typeof state.breakEndTs === "number") {
      showOverlay(state.breakEndTs);
    }
  } catch (e) {
    // Background not ready or extension reloaded; no recovery needed.
  }
})();
```

- [ ] **Step 2: Manual verification — new tab during break gets overlay**

1. Reload the extension.
2. In service worker console:
   ```js
   await chrome.storage.local.set({ state: { workMin: 60, breakMin: 1, phase: "working", phaseStartTs: Date.now(), pausedRemainingMs: null } });
   await transitionToBreak();
   ```
3. Expected: overlay appears on currently open tabs.
4. Open a NEW tab to https://example.org. Expected: overlay appears immediately on the new tab with the correct remaining time.
5. Wait for break to end → all overlays disappear.
6. Reset: `await chrome.storage.local.clear()` then reload extension.

- [ ] **Step 3: Commit**

```bash
git add screenpaws/content.js
git commit -m "feat(screenpaws): render overlay on tabs opened mid-break"
```

---

### Task 9: Popup HTML + CSS

**Files:**
- Modify: `screenpaws/popup.html` (replace)
- Modify: `screenpaws/popup.css` (replace)

- [ ] **Step 1: Replace `screenpaws/popup.html`**

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header class="sp-header">
    <h1>ScreenPaws</h1>
  </header>

  <section class="sp-status">
    <div class="sp-phase" id="phaseLabel">—</div>
    <div class="sp-remaining" id="remainingLabel">--:--</div>
  </section>

  <section class="sp-settings">
    <label class="sp-field">
      <span>사용 시간</span>
      <select id="workSelect">
        <option value="10">10분</option>
        <option value="30">30분</option>
        <option value="60" selected>60분</option>
        <option value="90">90분</option>
        <option value="120">120분</option>
      </select>
    </label>

    <label class="sp-field">
      <span>휴식 시간</span>
      <select id="breakSelect">
        <option value="3">3분</option>
        <option value="5" selected>5분</option>
        <option value="10">10분</option>
      </select>
    </label>
  </section>

  <section class="sp-actions">
    <button id="pauseResumeBtn" type="button">일시정지</button>
    <button id="breakNowBtn" type="button">즉시 휴식</button>
  </section>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `screenpaws/popup.css`**

```css
* { box-sizing: border-box; }

body {
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: 16px;
  min-width: 260px;
  background: #fafafa;
  color: #222;
}

.sp-header h1 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
}

.sp-status {
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  margin-bottom: 14px;
}

.sp-phase {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}

.sp-remaining {
  font-size: 32px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sp-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.sp-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.sp-field select {
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
}

.sp-actions {
  display: flex;
  gap: 8px;
}

.sp-actions button {
  flex: 1;
  padding: 8px 0;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
}

.sp-actions button:hover {
  background: #f0f0f0;
}

.sp-actions button:active {
  background: #e0e0e0;
}
```

- [ ] **Step 3: Manual verification — popup looks right**

1. Reload the extension.
2. Click the ScreenPaws icon → popup opens.
3. Expected: header, status card with "—" / "--:--", two select dropdowns (사용 시간 / 휴식 시간), two buttons (일시정지 / 즉시 휴식). Layout looks clean.
4. Selects are interactive; buttons are clickable but currently do nothing.

- [ ] **Step 4: Commit**

```bash
git add screenpaws/popup.html screenpaws/popup.css
git commit -m "feat(screenpaws): popup markup and styling"
```

---

### Task 10: Popup JS — wire up state, controls, and live refresh

**Files:**
- Modify: `screenpaws/popup.js` (replace)

- [ ] **Step 1: Replace `screenpaws/popup.js`**

```js
// ScreenPaws — popup
const phaseLabel = document.getElementById("phaseLabel");
const remainingLabel = document.getElementById("remainingLabel");
const workSelect = document.getElementById("workSelect");
const breakSelect = document.getElementById("breakSelect");
const pauseResumeBtn = document.getElementById("pauseResumeBtn");
const breakNowBtn = document.getElementById("breakNowBtn");

const PHASE_LABEL = {
  working: "사용 중",
  break: "휴식 중",
  paused: "일시정지됨"
};

let refreshIntervalId = null;
let lastState = null;

function formatRemaining(sec) {
  const total = Math.max(0, sec);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state) return;
    lastState = state;
    phaseLabel.textContent = PHASE_LABEL[state.phase] ?? state.phase;
    remainingLabel.textContent = formatRemaining(state.remainingSec);
    workSelect.value = String(state.workMin);
    breakSelect.value = String(state.breakMin);
    pauseResumeBtn.textContent = state.phase === "paused" ? "재개" : "일시정지";
    pauseResumeBtn.disabled = state.phase === "break";
    breakNowBtn.disabled = state.phase !== "working";
  } catch (e) {
    console.error("[ScreenPaws] refresh failed:", e);
  }
}

workSelect.addEventListener("change", async () => {
  const workMin = Number(workSelect.value);
  await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", workMin });
  await refresh();
});

breakSelect.addEventListener("change", async () => {
  const breakMin = Number(breakSelect.value);
  await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", breakMin });
  await refresh();
});

pauseResumeBtn.addEventListener("click", async () => {
  if (!lastState) return;
  if (lastState.phase === "paused") {
    await chrome.runtime.sendMessage({ type: "RESUME" });
  } else if (lastState.phase === "working") {
    await chrome.runtime.sendMessage({ type: "PAUSE" });
  }
  await refresh();
});

breakNowBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "START_BREAK_NOW" });
  await refresh();
});

// Initial render + live refresh while popup is open.
refresh();
refreshIntervalId = setInterval(refresh, 1000);
window.addEventListener("unload", () => {
  if (refreshIntervalId !== null) clearInterval(refreshIntervalId);
});
```

- [ ] **Step 2: Manual verification — popup controls work end-to-end**

1. Reload the extension.
2. Open a regular page (https://example.com).
3. Click the ScreenPaws icon. Popup shows "사용 중" with countdown ~`60:00` ticking down each second.
4. Change "사용 시간" to 10분 → countdown jumps to ~`10:00`.
5. Click "일시정지" → label becomes "일시정지됨", countdown stops, button text changes to "재개".
6. Click "재개" → countdown resumes.
7. Click "즉시 휴식" → overlay appears on the underlying page; popup label becomes "휴식 중" with break countdown.
8. Wait for break to end naturally OR run `await transitionToWorking()` in service worker console → overlay vanishes, popup returns to "사용 중".
9. Reset: `await chrome.storage.local.clear()` then reload extension.

- [ ] **Step 3: Commit**

```bash
git add screenpaws/popup.js
git commit -m "feat(screenpaws): popup controls and live state refresh"
```

---

### Task 11: Generate icons + register in manifest

**Files:**
- Create: `screenpaws/assets/icon-16.png`
- Create: `screenpaws/assets/icon-48.png`
- Create: `screenpaws/assets/icon-128.png`
- Modify: `screenpaws/manifest.json`

- [ ] **Step 1: Generate three solid-color PNG icons via PowerShell**

Run from the project root (`C:\Users\nsand\OneDrive\Desktop\p1`):

```powershell
Add-Type -AssemblyName System.Drawing
foreach ($size in 16, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 255, 138, 76))
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $fontSize = [Math]::Max(6, [int]($size * 0.55))
  $font = New-Object System.Drawing.Font "Segoe UI Emoji", $fontSize, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString("S", $font, $brush, $rect, $sf)
  $g.Dispose()
  $bmp.Save("screenpaws\assets\icon-$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
```

(Orange square with a white "S" centered. Replace later if you want a real cat icon.)

- [ ] **Step 2: Update `screenpaws/manifest.json` to reference icons**

Add the top-level `"icons"` field and `"default_icon"` inside `"action"`. The full `manifest.json` should now read:

```json
{
  "manifest_version": 3,
  "name": "ScreenPaws",
  "version": "0.1.0",
  "description": "Forces you to take breaks with a cute cat overlay.",
  "permissions": ["storage", "alarms", "notifications"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "icons": {
    "16": "assets/icon-16.png",
    "48": "assets/icon-48.png",
    "128": "assets/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "assets/icon-16.png",
      "48": "assets/icon-48.png",
      "128": "assets/icon-128.png"
    }
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle",
    "all_frames": false
  }],
  "web_accessible_resources": [{
    "resources": ["assets/cat.webp"],
    "matches": ["<all_urls>"]
  }]
}
```

- [ ] **Step 3: Manual verification — toolbar icon visible**

1. Reload the extension at `chrome://extensions/`.
2. Toolbar icon now shows the orange "S" instead of the puzzle piece.
3. Extension card on the management page also shows the icon.
4. No errors in the manifest panel.

- [ ] **Step 4: Commit**

```bash
git add screenpaws/assets/icon-16.png screenpaws/assets/icon-48.png screenpaws/assets/icon-128.png screenpaws/manifest.json
git commit -m "feat(screenpaws): add toolbar/manifest icons"
```

---

### Task 12: End-to-end manual test sweep

**Files:** none (verification only — file a fix-up commit per task if anything breaks)

Execute every scenario from the spec's Test Plan. Use the dev override at the top of this plan (10s work / 3s break) for fast cycling. Reset (`chrome.storage.local.clear()` + reload) between scenarios that mutate state.

- [ ] **Scenario 1: Fresh install starts working timer**

  Remove + reload extension. Open popup → phase="사용 중", countdown 60:00 → ticks down.

- [ ] **Scenario 2: Working time elapses → overlay + notification**

  Set `workMin = 10/60`, `breakMin = 1`, then `await scheduleTransition(await loadState())` in SW console. Wait 10s. Overlay appears on every open tab; OS notification fires.

- [ ] **Scenario 3: Break completes → working resumes**

  Wait for the 1-min break to end. Overlay vanishes; popup shows "사용 중".

- [ ] **Scenario 4: Multi-tab simultaneous overlay**

  Open 3 tabs to different sites. Trigger break (popup → 즉시 휴식). All 3 show overlay at once.

- [ ] **Scenario 5: Switching tabs during break**

  While overlay is up, switch to a different tab — overlay is also there.

- [ ] **Scenario 6: Restricted page during break**

  Trigger break, then navigate to `chrome://settings`. The overlay is absent (cannot inject) but the OS notification was visible. Acceptable per spec.

- [ ] **Scenario 7: Pause halts the timer**

  In working phase, click 일시정지. Popup countdown freezes. Wait 30s, confirm SW console doesn't fire transition alarm.

- [ ] **Scenario 8: Resume continues from paused remaining time**

  Click 재개. Countdown resumes from where it stopped. Phase label returns to "사용 중".

- [ ] **Scenario 9: Start break now**

  In working phase, click 즉시 휴식. Overlay appears immediately with full break duration.

- [ ] **Scenario 10: Survive Chrome restart mid-cycle**

  Set `workMin = 5`, trigger working phase, wait 1 minute. Quit Chrome entirely (close all windows, ensure background process exits). Reopen Chrome. Open popup → phase still "사용 중" with ~4 minutes remaining. (For mid-break test: trigger break, close Chrome, reopen → if break time has elapsed, working phase resumed; if still in break, overlay reappears on open tabs.)

- [ ] **Scenario 11: Key blocking during break**

  Trigger break. Press Escape, F11, Tab, Ctrl+W repeatedly — overlay stays. (Alt+F4 cannot be blocked from a content script — closing Chrome does dismiss the overlay; that is documented.)

- [ ] **Scenario 12: Mid-cycle settings change**

  In working phase with ~30 min remaining, change 사용 시간 to 10분. Popup countdown jumps to ~10:00 and continues ticking. Alarm reschedules (check SW console for new "alarm scheduled" log).

- [ ] **Wrap-up commit (only if any fix-up was needed)**

```bash
git add screenpaws/
git commit -m "fix(screenpaws): manual test sweep adjustments"
```

If everything passed without changes, just announce the test sweep is complete — no commit needed.
