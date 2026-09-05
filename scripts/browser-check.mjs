// browser-check.mjs —— 真瀏覽器驗收(playwright-core + 系統 Edge,零下載;golf3d 範式)。
// 用法:npm run build && npx vite preview --port 4173 &  然後  node scripts/browser-check.mjs
//      或 CHECK_URL="https://..." node scripts/browser-check.mjs(直驗線上)
// 檢查:0 pageerror、開賽真 click、五檔視角各截一張、HUD 無 undefined/NaN、visible 全 boolean、結算卡出現。
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHECK_URL = process.env.CHECK_URL || "http://localhost:4173/";
const OUT = fileURLToPath(new URL("../screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });
let n = 0, fails = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  return chromium.launch({ headless: true });
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(CHECK_URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__racing3d && window.__racing3d.scene, null, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "01-home.png" });
ok(await page.isVisible("#homeScreen"), "首頁可見");

// 選單:選 1 圈、3 對手、入門、藍車,真 click 開始
await page.selectOption("#lapsSelect", "1");
await page.selectOption("#aiSelect", "3");
await page.selectOption("#difficultySelect", "easy");
await page.selectOption("#colorSelect", "1");
await page.click("#startButton");
await page.waitForTimeout(300);
// 第一次開賽會跳玩法說明 ⇒ 真 click 關掉(截圖繞不過蓋版)
if (await page.isVisible("#helpOverlay.visible")) { await page.click("#helpCloseButton"); ok(true, "玩法說明第一次自動跳、可關"); }
ok(await page.evaluate(() => window.__racing3d.phase === "countdown" || window.__racing3d.phase === "racing"), "開賽進倒數/比賽");
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + "02-countdown.png" });
// 讓玩家車自動駕駛,穩定截圖
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(5500);
ok(await page.evaluate(() => window.__racing3d.phase === "racing"), "倒數結束進 racing");
ok(await page.evaluate(() => window.__racing3d.player.speed > 5), "自動駕駛跑起來了");

const views = ["chase", "hood", "cockpit", "bird", "tv"];
for (let i = 0; i < views.length; i++) {
  await page.keyboard.press(String(i + 1));
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const g = window.__racing3d; const c = g.camera;
    const rig = g.rigs.get(g.player);
    return { view: g.camView, tag: document.getElementById("viewTag").textContent, fin: [c.position.x, c.position.y, c.position.z, c.fov].every(Number.isFinite),
      hidden: rig.hide.map((m) => m.visible), near: c.near };
  });
  ok(info.view === views[i], `視角 ${views[i]} 已切換`);
  ok(info.fin, `視角 ${views[i]} 鏡頭有限`);
  ok(!/undefined|NaN/.test(info.tag), `視角標籤「${info.tag}」無 undefined`);
  if (views[i] === "cockpit") ok(info.hidden.every((v) => v === false) && info.near <= 0.05, "駕駛座:車艙藏起、near 0.05");
  else ok(info.hidden.every((v) => v === true), `視角 ${views[i]}:車艙顯示`);
  await page.screenshot({ path: OUT + `0${i + 3}-view-${views[i]}.png` });
}
// 駕駛座:玩家自己右轉一下再截(方向盤要看得到轉)
await page.keyboard.press("3");
await page.evaluate(() => { window.__racing3d.autopilot = false; });
await page.keyboard.down("ArrowUp"); await page.keyboard.down("ArrowRight");      // 真鍵盤(main.js 每幀從鍵盤狀態合成 input)
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + "08-cockpit-steer-right.png" });
const wheelZ = await page.evaluate(() => window.__racing3d.rigs.get(window.__racing3d.player).cockpit.userData.wheel.rotation.z);
ok(wheelZ > 0.5, `方向盤右轉 rotation.z=${wheelZ.toFixed(2)}`);
await page.keyboard.up("ArrowRight"); await page.keyboard.up("ArrowUp");
await page.evaluate(() => { window.__racing3d.autopilot = true; });

// HUD 文字健康
const hudText = await page.evaluate(() => ["raceCard", "speedPanel", "statusMessage", "viewTag"].map((id) => document.getElementById(id).textContent).join(" | "));
ok(!/undefined|NaN|Invalid/.test(hudText), "HUD 無 undefined/NaN");
// visible 全 boolean(0827 通則)
const badVis = await page.evaluate(() => { let bad = 0; window.__racing3d.scene.traverse((o) => { if (typeof o.visible !== "boolean") bad++; }); return bad; });
ok(badVis === 0, `場景 visible 全 boolean(壞 ${badVis})`);
// 30 幀同步 update 不丟例外(出貨前最低保險)
const upErr = await page.evaluate(() => { try { for (let i = 0; i < 30; i++) window.__racing3d.update(1 / 60); return ""; } catch (e) { return String(e); } });
ok(upErr === "", `30 幀 update 無例外 ${upErr}`);

// 快轉到完賽:同步步進(1 圈)
await page.keyboard.press("1");
const fin = await page.evaluate(() => {
  const g = window.__racing3d; g.autopilot = true;
  for (let i = 0; i < 60 * 240 && g.phase !== "finished"; i++) g.update(1 / 60);
  return { phase: g.phase, rank: g.results && g.results.rank, time: g.results && g.results.time };
});
ok(fin.phase === "finished", `快轉完賽 ${fin.phase} 名次 ${fin.rank} 時間 ${fin.time && fin.time.toFixed(1)}`);
await page.waitForTimeout(1800);
ok(await page.isVisible("#resultOverlay.visible"), "結算卡出現");
const resText = await page.textContent("#resultOverlay");
ok(!/undefined|NaN/.test(resText), "結算卡無 undefined/NaN");
await page.screenshot({ path: OUT + "09-results.png" });
// 回選單
await page.click("#resultMenuButton");
await page.waitForTimeout(500);
ok(await page.isVisible("#homeScreen.visible"), "回選單");
ok(errors.length === 0, `0 pageerror(${errors.length})`);
for (const e of errors) console.log("   ", e);
await browser.close();
console.log(`browser-check: ${n - fails}/${n} 通過${fails ? "  ✗ 有紅燈" : ""}`);
process.exit(fails ? 1 : 0);
