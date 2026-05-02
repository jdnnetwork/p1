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
  const breakEndTs = next.phaseStartTs + phaseDurationMs(next);
  await broadcastToTabs({ type: "BREAK_START", endTs: breakEndTs });
  await fireBreakNotification(next.breakMin);
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
  await broadcastToTabs({ type: "BREAK_END" });
  console.log("[ScreenPaws] -> working");
  return next;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const state = await loadState();
  if (state.phase === "working") await transitionToBreak();
  else if (state.phase === "break") await transitionToWorking();
});

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
