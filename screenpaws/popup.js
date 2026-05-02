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
