import "./styles.css";
// main.js —— UI 接線:首頁選單、HUD、小地圖、鍵盤/觸控/手把 → game.input、音效、beacons、PWA。
// 鍵位:↑/W 油門、↓/S 煞車、←→/AD 轉向、Shift 渦輪、Space 手煞、V 視角(1~5 直跳)、R 回賽道、H 玩法、Esc 選單。
import { RacingGame, CAM_VIEWS, CAM_LABELS, CAR_COLORS, LAP_OPTIONS, AI_OPTIONS, TRACKS, TRACK_IDS, DIFFICULTY, fmtTime } from "./game.js";
import { AudioManager } from "./audio.js";
import { GamepadInput } from "./gamepad.js";
import { loadSettings, saveSettings } from "./storage.js";

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("gameCanvas"),
  raceCard: $("raceCard"), lapText: $("lapText"), rankText: $("rankText"), timeText: $("timeText"), lapTimeText: $("lapTimeText"), bestText: $("bestText"),
  miniWrap: $("miniWrap"), miniMap: $("miniMap"), viewTag: $("viewTag"),
  speedPanel: $("speedPanel"), speedText: $("speedText"), turboRow: $("turboRow"), turboFill: $("turboFill"),
  countdown: $("countdown"), wrongWay: $("wrongWay"), statusMessage: $("statusMessage"),
  tLeft: $("tLeft"), tRight: $("tRight"), tGas: $("tGas"), tBrake: $("tBrake"), tBoost: $("tBoost"),
  menuButton: $("menuButton"), audioButton: $("audioButton"), cameraButton: $("cameraButton"), rescueButton: $("rescueButton"), helpButton: $("helpButton"), fsButton: $("fsButton"),
  helpOverlay: $("helpOverlay"), helpCloseButton: $("helpCloseButton"),
  resultOverlay: $("resultOverlay"), resultEyebrow: $("resultEyebrow"), resultTitle: $("resultTitle"), resultText: $("resultText"), resultTable: $("resultTable"),
  resultMenuButton: $("resultMenuButton"), resultAgainButton: $("resultAgainButton"),
  homeScreen: $("homeScreen"), trackSelect: $("trackSelect"), lapsSelect: $("lapsSelect"), aiSelect: $("aiSelect"),
  difficultySelect: $("difficultySelect"), colorSelect: $("colorSelect"), audioSelect: $("audioSelect"), startButton: $("startButton"),
};

/* ── 設定(記住上次選擇) ── */
const saved = loadSettings();
const settings = {
  trackId: TRACKS[saved.trackId] ? saved.trackId : "meadow",
  laps: LAP_OPTIONS.includes(Number(saved.laps)) ? Number(saved.laps) : 3,
  aiCount: AI_OPTIONS.includes(Number(saved.aiCount)) ? Number(saved.aiCount) : 3,
  difficulty: DIFFICULTY[saved.difficulty] ? saved.difficulty : "easy",
  colorIdx: Number.isInteger(saved.colorIdx) && saved.colorIdx >= 0 && saved.colorIdx < CAR_COLORS.length ? saved.colorIdx : 0,
};
let audioEnabled = saved.audioEnabled !== false;
let helpSeen = saved.helpSeen === true;

const fill = (sel, items, value) => {
  sel.innerHTML = "";
  for (const it of items) {
    const o = document.createElement("option");
    o.value = String(it.value); o.textContent = it.label;
    if (String(it.value) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
};
fill(ui.trackSelect, TRACK_IDS.map((id) => ({ value: id, label: `${TRACKS[id].emoji} ${TRACKS[id].label}` })), settings.trackId);
fill(ui.lapsSelect, LAP_OPTIONS.map((n) => ({ value: n, label: `${n} 圈` })), settings.laps);
fill(ui.aiSelect, AI_OPTIONS.map((n) => ({ value: n, label: n === 0 ? "沒有對手(練習)" : `${n} 台電腦車` })), settings.aiCount);
fill(ui.difficultySelect, Object.values(DIFFICULTY).map((d) => ({ value: d.id, label: `${d.label}(極速 ${Math.round(d.maxSpeed * 3.6)} km/h)` })), settings.difficulty);
fill(ui.colorSelect, CAR_COLORS.map((c, i) => ({ value: i, label: c.label })), settings.colorIdx);
ui.audioSelect.value = audioEnabled ? "on" : "off";

/* ── 遊戲 + 音效 ── */
const audio = new AudioManager();
audio.setEnabled(audioEnabled);
const game = new RacingGame({ canvas: ui.canvas });
window.__racing3d = game;   // dev hook(Playwright 驗收)
window.__racing3dAudio = audio;
game.settings.colorIdx = settings.colorIdx;
game.setTrack(settings.trackId);
game.setPlayerColor(settings.colorIdx);

const resize = () => {
  const w = ui.canvas.clientWidth || window.innerWidth, h = ui.canvas.clientHeight || window.innerHeight;
  game.resize(w, h);
};
window.addEventListener("resize", resize);
resize();

/* ── 選單事件 ── */
ui.trackSelect.addEventListener("change", () => { settings.trackId = ui.trackSelect.value; saveSettings({ trackId: settings.trackId }); game.setTrack(settings.trackId); game.setPlayerColor(settings.colorIdx); buildMiniBase(); });
ui.lapsSelect.addEventListener("change", () => { settings.laps = Number(ui.lapsSelect.value); saveSettings({ laps: settings.laps }); });
ui.aiSelect.addEventListener("change", () => { settings.aiCount = Number(ui.aiSelect.value); saveSettings({ aiCount: settings.aiCount }); });
ui.difficultySelect.addEventListener("change", () => { settings.difficulty = ui.difficultySelect.value; saveSettings({ difficulty: settings.difficulty }); });
ui.colorSelect.addEventListener("change", () => { settings.colorIdx = Number(ui.colorSelect.value); saveSettings({ colorIdx: settings.colorIdx }); game.setPlayerColor(settings.colorIdx); });
ui.audioSelect.addEventListener("change", () => setAudio(ui.audioSelect.value === "on"));

function setAudio(on) {
  audioEnabled = on;
  audio.setEnabled(on);
  ui.audioButton.textContent = on ? "音效開啟" : "音效關閉";
  ui.audioSelect.value = on ? "on" : "off";
  saveSettings({ audioEnabled: on });
}
ui.audioButton.addEventListener("click", () => { setAudio(!audioEnabled); audio.unlock(); });

/* 內建瀏覽器提醒(in-app-browser-guard):教會連結都走 LINE 發,LINE 的 WebView 常拒絕全螢幕/鎖向。
   只提醒不擋、開場就講、只講「換瀏覽器」那一條。 */
const IN_APP = (() => {
  const ua = navigator.userAgent || "";
  if (/\bLine\//i.test(ua) || /\bLIFF\b/i.test(ua)) return { n: "LINE", m: "右上角「⋯」→「用其他瀏覽器開啟」" };
  if (/FBAN|FBAV|FB_IAB|FB4A/i.test(ua)) return { n: "Facebook", m: "右上角「⋯」→「在外部瀏覽器中開啟」" };
  if (/Instagram/i.test(ua)) return { n: "Instagram", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  if (/MicroMessenger/i.test(ua)) return { n: "微信", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  return null;
})();
if (IN_APP) {
  const hint = document.createElement("p");
  hint.className = "home-hint";
  hint.style.cssText = "background:rgba(255,180,60,.16);padding:8px 12px;border-radius:12px";
  hint.textContent = `📱 你是從 ${IN_APP.n} 打開的:全螢幕與橫向鎖定可能沒反應。想要完整體驗請 ${IN_APP.m}。`;
  ui.startButton.parentNode.insertBefore(hint, ui.startButton);
}

/* 全螢幕 + 鎖橫向(force-landscape-pwa:必須在使用者手勢裡、鎖向在全螢幕之後) */
function enterImmersive(force = false) {
  try {
    if (!force && !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return;
    const lock = () => { try { screen.orientation?.lock?.("landscape").catch(() => {}); } catch { /* ignore */ } };
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      const p = el.requestFullscreen();
      p && p.then ? p.then(lock).catch(() => {}) : lock();
    } else lock();
  } catch { /* ignore */ }
}
ui.fsButton.addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
  if (!document.documentElement.requestFullscreen || IN_APP) { flashMessage(IN_APP ? `${IN_APP.n} 內建瀏覽器不支援全螢幕:${IN_APP.m}` : "這個瀏覽器不支援全螢幕"); return; }
  enterImmersive(true);
});
window.addEventListener("pointerdown", () => enterImmersive(false), { once: true, passive: true });

function startRace() {
  audio.unlock(); audio.startEngine();
  enterImmersive(false);
  ui.homeScreen.classList.remove("visible");
  ui.resultOverlay.classList.remove("visible");
  game.startRace({ ...settings });
  buildMiniBase();
  raceStartedAt = performance.now();
  if (!helpSeen) { openHelp(); helpSeen = true; saveSettings({ helpSeen: true }); }
}
ui.startButton.addEventListener("click", startRace);
ui.resultAgainButton.addEventListener("click", startRace);
const toMenu = () => {
  ui.resultOverlay.classList.remove("visible");
  ui.helpOverlay.classList.remove("visible");
  ui.homeScreen.classList.add("visible");
  game.backToMenu();
};
ui.menuButton.addEventListener("click", toMenu);
ui.resultMenuButton.addEventListener("click", toMenu);
ui.cameraButton.addEventListener("click", () => { game.cycleCamView(); audio.uiTap(); });
ui.rescueButton.addEventListener("click", () => game.requestRescue());

function openHelp() { ui.helpOverlay.classList.add("visible"); }
function closeHelp() { ui.helpOverlay.classList.remove("visible"); }
ui.helpButton.addEventListener("click", openHelp);
ui.helpCloseButton.addEventListener("click", closeHelp);

/* ── 輸入:鍵盤 + 觸控 + 手把,每幀合成 game.input ── */
const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false, boost: false };
const gp = new GamepadInput({ mode: "poll", onConnect: (on) => { if (on) flashMessage("🎮 手把已連線"); } });
let steerSmooth = 0;

window.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "INPUT")) return;
  const k = e.key;
  if (k === "Escape") { if (ui.helpOverlay.classList.contains("visible")) closeHelp(); else if (game.phase !== "menu") toMenu(); return; }
  if (k === "h" || k === "H") { ui.helpOverlay.classList.contains("visible") ? closeHelp() : openHelp(); return; }
  if (k === "v" || k === "V") { game.cycleCamView(); audio.uiTap(); return; }
  if (k >= "1" && k <= "5") { const id = CAM_VIEWS[Number(k) - 1]; if (id) { game.setCamView(id); audio.uiTap(); } return; }
  if (k === "r" || k === "R") { game.requestRescue(); return; }
  if (k === "Enter" && game.phase === "menu" && ui.homeScreen.classList.contains("visible")) { startRace(); return; }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Shift"].includes(k)) e.preventDefault();
  keys.add(k.length === 1 ? k.toLowerCase() : k);
  audio.unlock();
});
window.addEventListener("keyup", (e) => { const k = e.key; keys.delete(k.length === 1 ? k.toLowerCase() : k); });
window.addEventListener("blur", () => keys.clear());

const bindHold = (btn, name) => {
  if (!btn) return;
  const on = (e) => { e.preventDefault(); touch[name] = true; btn.classList.add("active"); audio.unlock(); try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  const off = () => { touch[name] = false; btn.classList.remove("active"); };
  btn.addEventListener("pointerdown", on);
  btn.addEventListener("pointerup", off); btn.addEventListener("pointercancel", off); btn.addEventListener("pointerleave", off);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
};
bindHold(ui.tLeft, "left"); bindHold(ui.tRight, "right"); bindHold(ui.tGas, "gas"); bindHold(ui.tBrake, "brake"); bindHold(ui.tBoost, "boost");

function pollInput(dt) {
  gp.poll();
  if (gp.justPressed.Y) { game.cycleCamView(); audio.uiTap(); }
  if (gp.justPressed.START && game.phase !== "menu") toMenu();
  if (gp.justPressed.A && game.phase === "menu" && ui.homeScreen.classList.contains("visible")) startRace();
  const left = keys.has("ArrowLeft") || keys.has("a") || touch.left || gp.dir.left;
  const right = keys.has("ArrowRight") || keys.has("d") || touch.right || gp.dir.right;
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  // 鍵盤是 −1/0/1:再做一層「按久轉得多」的平滑,小孩點一下不會猛甩
  steerSmooth += (target - steerSmooth) * Math.min(1, dt * (target === 0 ? 12 : 6));
  const inp = game.input;
  inp.steer = Math.abs(steerSmooth) < 0.01 ? 0 : steerSmooth;
  inp.throttle = (keys.has("ArrowUp") || keys.has("w") || touch.gas || gp.held.A || gp.held.RT) ? 1 : 0;
  inp.brake = (keys.has("ArrowDown") || keys.has("s") || touch.brake || gp.held.B || gp.held.LT) ? 1 : 0;
  inp.boost = keys.has("Shift") || touch.boost || !!gp.held.X;
  inp.handbrake = keys.has(" ") || !!gp.held.RB;
}

/* ── 小地圖:賽道底圖一張(換賽道重畫),車點每幀疊 ── */
let miniBase = null, miniFit = { s: 1, ox: 0, oy: 0 };
function buildMiniBase() {
  const t = game.track; if (!t) return;
  const W = ui.miniMap.width, H = ui.miniMap.height;
  const xs = t.samples.map((p) => p.x), zs = t.samples.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const s = Math.min((W - 24) / (maxX - minX), (H - 24) / (maxZ - minZ));
  miniFit = { s, ox: (W - (maxX - minX) * s) / 2 - minX * s, oy: (H - (maxZ - minZ) * s) / 2 - minZ * s };
  const off = document.createElement("canvas"); off.width = W; off.height = H;
  const c = off.getContext("2d");
  c.lineCap = "round"; c.lineJoin = "round";
  c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = Math.max(4, t.halfW * 2 * s);
  c.beginPath();
  t.samples.forEach((p, i) => { const [x, y] = miniXY(p.x, p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.closePath(); c.stroke();
  c.strokeStyle = "#3b4150"; c.lineWidth = Math.max(2, t.halfW * 2 * s - 2); c.stroke();
  const st = t.samples[0]; const [sx, sy] = miniXY(st.x, st.z);
  c.fillStyle = "#ffd24a"; c.beginPath(); c.arc(sx, sy, 4, 0, Math.PI * 2); c.fill();
  miniBase = off;
}
function miniXY(x, z) { return [miniFit.ox + x * miniFit.s, miniFit.oy + z * miniFit.s]; }
function drawMini(hud) {
  if (!miniBase) return;
  const c = ui.miniMap.getContext("2d");
  c.clearRect(0, 0, ui.miniMap.width, ui.miniMap.height);
  c.drawImage(miniBase, 0, 0);
  for (const car of hud.cars) {
    if (car.isPlayer) continue;
    const [x, y] = miniXY(car.x, car.z);
    c.fillStyle = "#" + car.colorHex.toString(16).padStart(6, "0");
    c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
  }
  const me = hud.cars.find((car) => car.isPlayer);
  if (me) {
    const [x, y] = miniXY(me.x, me.z);
    c.fillStyle = "#" + me.colorHex.toString(16).padStart(6, "0");
    c.strokeStyle = "#fff"; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}
buildMiniBase();

/* ── HUD ── */
let lastCountdown = 0, flashTimer = 0;
function flashMessage(text) { ui.statusMessage.textContent = text; flashTimer = 2.5; }
game.onHud = (hud) => {
  const racing = hud.phase === "racing" || hud.phase === "countdown" || hud.phase === "finished";
  ui.raceCard.hidden = !racing; ui.miniWrap.hidden = !racing; ui.speedPanel.hidden = !racing;
  ui.rescueButton.hidden = hud.phase !== "racing";
  if (racing) {
    ui.lapText.textContent = `第 ${hud.lap} / ${hud.laps} 圈`;
    ui.rankText.textContent = hud.total > 1 ? `第 ${hud.rank} 名 / ${hud.total}` : "練習模式";
    ui.timeText.textContent = fmtTime(hud.raceT);
    ui.lapTimeText.textContent = fmtTime(hud.lapT);
    ui.bestText.textContent = fmtTime(hud.bestLap);
    ui.speedText.textContent = String(hud.speedKmh);
    ui.turboFill.style.transform = `scaleX(${Math.max(0, Math.min(1, hud.turbo)).toFixed(3)})`;
    ui.turboRow.classList.toggle("tired", !!hud.tired);
    ui.turboRow.classList.toggle("boosting", !!hud.boosting);
    ui.viewTag.textContent = `視角:${hud.activeView === "tv" && hud.camView !== "tv" ? "轉播機位(結算)" : hud.camLabel}`;
    drawMini(hud);
  }
  ui.wrongWay.hidden = !hud.wrongWay;
  if (hud.phase === "countdown" && hud.countdown >= 1) {
    ui.countdown.hidden = false; ui.countdown.classList.remove("go");
    if (hud.countdown !== lastCountdown) { ui.countdown.textContent = String(hud.countdown); ui.countdown.style.animation = "none"; void ui.countdown.offsetWidth; ui.countdown.style.animation = ""; lastCountdown = hud.countdown; }
  } else if (hud.phase === "racing" && hud.raceT < 1.1) {
    ui.countdown.hidden = false; ui.countdown.classList.add("go"); ui.countdown.textContent = "GO!";
  } else { ui.countdown.hidden = true; lastCountdown = 0; }
  if (flashTimer <= 0 && hud.message) ui.statusMessage.textContent = hud.message;
  else if (flashTimer <= 0 && !hud.message && racing) ui.statusMessage.textContent = hud.phase === "finished" ? "完賽!看看結算,或再來一場。" : "加油!";
};

/* ── 事件 → 音效/結算 ── */
let raceStartedAt = 0;
game.onEvent = (type, d) => {
  switch (type) {
    case "countdown": audio.countdown(d.n); break;
    case "go": audio.go(); break;
    case "bump": audio.bump(d.speed); break;
    case "offtrack": audio.offtrack(); break;
    case "boost": audio.boost(); break;
    case "lap": audio.lap(d.final); break;
    case "wrongway": audio.wrongWay(); break;
    case "rescue": audio.rescue(); break;
    case "finish": showResults(d); audio.finish(d.rank); sendDone(); break;
    default: break;
  }
};

function showResults(r) {
  ui.resultEyebrow.textContent = `${r.trackLabel}・${r.laps} 圈・${r.difficulty}`;
  ui.resultTitle.textContent = `${r.medal} ${r.title}`;
  ui.resultText.textContent = `總時間 ${fmtTime(r.time)}・最佳單圈 ${fmtTime(r.bestLap)}`;
  ui.resultTable.innerHTML = "";
  for (const row of r.rows) {
    const tr = document.createElement("tr");
    if (row.isPlayer) tr.className = "me";
    const color = "#" + row.colorHex.toString(16).padStart(6, "0");
    tr.innerHTML = `<td>${row.rank}</td><td><span class="dot" style="background:${color}"></span>${row.name}</td><td>${row.time != null ? fmtTime(row.time) : "還在跑"}</td><td>${row.bestLap ? "單圈 " + fmtTime(row.bestLap) : ""}</td>`;
    ui.resultTable.appendChild(tr);
  }
  setTimeout(() => ui.resultOverlay.classList.add("visible"), 1200);   // 先看 1.2 秒繞場,再出結算卡
}

/* ── beacons:-done(玩完一場)/ -dwell(真實停留) ── */
const PING = "https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=";
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
function sendDone() {
  try {
    if (isLocal || !navigator.sendBeacon) return;
    const dt = Math.round((performance.now() - raceStartedAt) / 1000);
    navigator.sendBeacon(PING + "racing3d-done&t=" + dt);
  } catch { /* ignore */ }
}
const openedAt = performance.now();
let dwellSent = false;
function sendDwell() {
  if (dwellSent || isLocal) return;
  const s = Math.round((performance.now() - openedAt) / 1000);
  if (s >= 3 && s <= 1800 && navigator.sendBeacon) { dwellSent = true; navigator.sendBeacon(PING + "racing3d-dwell&t=" + s); }
}
window.addEventListener("pagehide", sendDwell);
document.addEventListener("visibilitychange", () => { if (document.hidden) { sendDwell(); audio.suspend(); } else audio.resume(); });

/* ── 主迴圈(輸入 + 引擎聲掛在 game 的 RAF 之前) ── */
let lastT = performance.now();
const origUpdate = game.update.bind(game);
game.update = (dt) => {
  pollInput(dt);
  origUpdate(dt);
  if (flashTimer > 0) flashTimer -= dt;
  const p = game.player, cfg = DIFFICULTY[game.settings.difficulty] || DIFFICULTY.easy;
  const active = game.phase === "racing" || game.phase === "finished";
  if (p) audio.setEngine(active ? (Math.abs(p.speed) / cfg.maxSpeed) : 0.1, active ? game.input.throttle : 0, !!p.boosting, Math.min(1, Math.abs(p.lat) / 6), active);
};
game.start();
void lastT;

/* PWA:SW 只在線上註冊(dev 會慢一版) */
if ("serviceWorker" in navigator && !isLocal) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}
