# ScreenPaws — Chrome Extension Design

**Date:** 2026-05-03
**Status:** Approved (awaiting implementation plan)

## Goal

A Chrome extension that forces the user to take breaks. After the user has the browser open for a configurable working period (default 60 min), a full-screen overlay appears on every tab showing a cute cat character (`cat.webp`) and a countdown for the break duration (default 5 min). The overlay cannot be dismissed; when the countdown reaches zero it disappears automatically and the working timer restarts.

## User Stories

- As a user, I open Chrome and the working timer starts automatically.
- As a user, after my chosen working period elapses, every tab is covered by an overlay with a cat and a countdown — I cannot interact with web content until the break ends.
- As a user, I open the extension popup to see remaining working time, change my work/break durations, pause/resume the timer, or trigger a break immediately.
- As a user, even if I switch to a `chrome://` page or the new tab page during a break, I get a system notification telling me to rest.
- As a user, if I close and reopen Chrome mid-cycle, the timer resumes from where it left off (state persists).

## Scope

### In Scope
- Single timer shared across all tabs and windows of a single Chrome profile.
- Popup UI with the controls listed below.
- Persistent settings via `chrome.storage.local`.
- Full-screen overlay injected into every regular web page during a break.
- System notification fallback for restricted pages (`chrome://`, Web Store, new tab).
- Manifest V3.

### Out of Scope
- Multiple cat characters or character customization.
- Skip/dismiss button on the overlay (hard block by design).
- Sync of settings across devices.
- Per-site rules or whitelists.
- Activity-based detection (idle vs. active). Timer counts wall-clock time while the browser is running.
- Automated tests (manual test plan only).

## Architecture

### File Layout
```
screenpaws/
├── manifest.json
├── background.js          # Service worker — timer + state
├── content.js             # Overlay injection
├── content.css            # Overlay styles
├── popup.html
├── popup.js
├── popup.css
└── assets/
    ├── cat.webp           # Provided
    ├── icon-16.png        # To create
    ├── icon-48.png        # To create
    └── icon-128.png       # To create
```

### Components & Responsibilities

**`background.js` (service worker)** — Single source of truth.
- Owns the timer, current phase, and settings.
- Uses `chrome.alarms` (not `setInterval`) so timing survives service-worker suspension.
- Persists state to `chrome.storage.local` so it can be restored when the worker wakes.
- Listens to `chrome.runtime.onStartup` and `chrome.runtime.onInstalled` to start the timer when Chrome launches or the extension is first installed.
- Broadcasts `BREAK_START` and `BREAK_END` messages to every content script.
- On `BREAK_START`, also fires a `chrome.notifications` notification (this lights up if the active tab is restricted; on regular tabs the overlay covers the screen anyway).
- Handles popup commands: `GET_STATE`, `UPDATE_SETTINGS`, `PAUSE`, `RESUME`, `START_BREAK_NOW`.

**`content.js`** — Auto-injected on every URL via `content_scripts` in the manifest.
- On load, asks background for current state. If currently in `break`, immediately renders overlay with the correct remaining time.
- Listens for `BREAK_START` / `BREAK_END` messages.
- Renders/removes the overlay DOM. Countdown ticks locally each second, computed from `phaseStartTs` so all tabs stay in sync.
- Captures and `preventDefault`s key events (`Escape`, `F11`, etc.) while the overlay is up.

**`popup.html` + `popup.js` + `popup.css`** — Settings + status panel.
- On open: `GET_STATE` → render current remaining time, current settings.
- Controls (all push commands to background):
  - Working time: 10 / 30 / 60 / 90 / 120 min
  - Break time: 3 / 5 / 10 min
  - Pause / Resume button
  - "Start break now" button
- Updates remaining time every second while open.

## Key Technical Decisions

### Timer mechanism: `chrome.alarms`
MV3 service workers are killed after ~30 s of inactivity, so `setInterval`/`setTimeout` are unreliable. `chrome.alarms` wakes the service worker at the scheduled time. We schedule a single one-shot alarm for the next phase transition (working→break or break→working).

### State persistence
On every state change (and only then) write to `chrome.storage.local`:
```js
{
  workMin: 60,
  breakMin: 5,
  phase: "working" | "break" | "paused",
  phaseStartTs: <ms epoch when current phase began>,
  pausedRemainingMs: <ms or null — only set when phase === "paused">
}
```
When the service worker wakes, it reads this and recomputes remaining time as `(workMin*60_000) - (Date.now() - phaseStartTs)`. If that value is ≤ 0 while in `working`, immediately fire `BREAK_START`.

### Pause / Resume
On `PAUSE`: compute current `remainingMs`, store it, set `phase = "paused"`, clear the alarm.
On `RESUME`: revert `phase` to `"working"` (or `"break"` if paused mid-break — but per spec a break cannot be paused; pausing during break is disabled in popup), set `phaseStartTs = Date.now() - (workMin*60_000 - pausedRemainingMs)`, reschedule alarm. (Pausing is only allowed during `working` phase.)

### Start break immediately
On `START_BREAK_NOW`: set `phase = "break"`, `phaseStartTs = Date.now()`, schedule alarm at `breakMin*60_000`, broadcast `BREAK_START`.

### Overlay z-index & dismissal
- `position: fixed; inset: 0; z-index: 2147483647;` — max signed 32-bit integer, beats any sane page CSS.
- Opaque background (no transparency) so page content cannot be seen.
- `pointer-events: auto` on overlay; the overlay itself swallows all clicks.
- Key events captured at `window` level with capture phase + `preventDefault` + `stopPropagation` for the duration of the overlay.
- Cat image loaded from `chrome.runtime.getURL('assets/cat.webp')` and shown centered with countdown text below.

### Restricted-page fallback (`C3`)
Content scripts cannot inject into `chrome://`, the Chrome Web Store, the default new-tab page, or the extension store. When `BREAK_START` fires we always also call `chrome.notifications.create` with title "휴식 시간이에요 🐱", body "5분간 쉬어요", icon = `assets/cat.webp`. Regular tabs get both the overlay and the notification; restricted tabs get only the notification.

## Permissions (`manifest.json`)

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

`tabs` permission is intentionally omitted — `chrome.tabs.sendMessage` works without it as long as we already have host permission.

## Message Protocol

Popup → background (responses awaited):
- `{type: "GET_STATE"}` → `{phase, remainingSec, workMin, breakMin}`
- `{type: "UPDATE_SETTINGS", workMin?, breakMin?}` → `{ok: true}`
- `{type: "PAUSE"}` → `{ok: true}`
- `{type: "RESUME"}` → `{ok: true}`
- `{type: "START_BREAK_NOW"}` → `{ok: true}`

Background → all content scripts (broadcast via `chrome.tabs.query` + `chrome.tabs.sendMessage`):
- `{type: "BREAK_START", endTs: <ms epoch>}`
- `{type: "BREAK_END"}`

Content script → background (on load only):
- `{type: "GET_STATE"}` → `{phase, breakEndTs?}` (so newly-loaded pages can render overlay if a break is in progress)

## Data Model

Stored in `chrome.storage.local` under a single key, e.g. `state`:

| Field | Type | Notes |
|---|---|---|
| `workMin` | number | Default 60 |
| `breakMin` | number | Default 5 |
| `phase` | string | `"working"` \| `"break"` \| `"paused"` |
| `phaseStartTs` | number | ms epoch — when current phase began |
| `pausedRemainingMs` | number \| null | Only non-null when paused |

## Error Handling

- `chrome.tabs.sendMessage` failures (tab navigated away, no content script loaded yet) — caught and ignored. The fresh page will run `content.js` which queries state on load.
- `chrome.notifications.create` failure (permission denied later) — logged to console, no recovery.
- Storage read failure on startup — fall back to defaults and log.
- Stale alarm (settings changed mid-cycle) — on every settings change, recompute the alarm: clear existing, schedule new one based on new duration.

## Test Plan (manual)

For testing convenience, set `workMin = 10/60` (i.e. 10 sec) and `breakMin = 3/60` via popup or directly in storage during dev.

| # | Scenario | Expected |
|---|---|---|
| 1 | Install extension, open a regular page | Timer starts; popup shows countdown |
| 2 | Wait until working time elapses | Overlay covers page; cat visible; countdown ticks; system notification fires |
| 3 | During break, wait until countdown reaches 0 | Overlay disappears; new working cycle begins |
| 4 | Open multiple tabs, trigger break | All tabs show overlay simultaneously |
| 5 | During break, switch tabs | New tab also shows overlay |
| 6 | During break, navigate to `chrome://settings` | Notification visible; no overlay (expected) |
| 7 | During working phase, click Pause | Timer halts; popup remaining time stops |
| 8 | Click Resume | Timer continues from paused remaining time |
| 9 | Click "Start break now" | Overlay appears immediately |
| 10 | Trigger break, close Chrome, reopen | Break still in progress with correct remaining time, OR working phase resumed correctly if break elapsed |
| 11 | During break, press Escape / F11 / Alt+F4 attempts in overlay | Keys swallowed (Alt+F4 cannot be blocked — that's OK and expected) |
| 12 | Change working time mid-cycle | Alarm reschedules; popup reflects new duration |

## Open Questions / Risks

- **Alt+F4 / browser close.** We cannot block this from a content script. User can always close Chrome to escape the break. This is accepted — the goal is to nudge, not imprison.
- **Multiple Chrome windows / profiles.** Each profile has its own service worker instance, so the timer is per-profile. Multiple windows of the same profile share state. Acceptable.
- **Service worker startup latency.** First message after a long idle may take ~100 ms while the worker boots. Acceptable.
- **`webp` browser support in overlays.** Modern Chrome supports it natively; no concern.
- **Icon assets (16/48/128 PNG).** Not yet provided. Implementation plan should include either generating these from `cat.webp` or asking the user to supply.
