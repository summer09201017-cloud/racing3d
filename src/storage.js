// storage.js —— 選單偏好(賽道/圈數/對手數/難度/車色/音效),localStorage 全包 try/catch。
const KEY = "racing3d-settings-v1";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

export function saveSettings(patch) {
  try {
    const cur = loadSettings();
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* Safari 私密模式等:靜默 */ }
}
