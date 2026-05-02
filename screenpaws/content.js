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
