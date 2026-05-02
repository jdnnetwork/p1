console.log("[ScreenPaws] content.js loaded on", location.href);

chrome.runtime.onMessage.addListener((msg) => {
  console.log("[ScreenPaws] message received:", msg);
});
