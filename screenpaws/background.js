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
