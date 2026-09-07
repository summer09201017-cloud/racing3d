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
// v3:結算紀錄行 / 彩帶(前三名才有)/ localStorage 已存
const recText = await page.textContent("#recordText");
ok(/紀錄/.test(recText) && !/undefined|NaN/.test(recText), `結算紀錄行「${recText}」`);
const hasConf = await page.evaluate(() => !!document.querySelector("canvas[data-confetti]"));
ok(hasConf === (fin.rank <= 3), `彩帶 ${hasConf ? "有" : "無"}(名次 ${fin.rank},前三名才放)`);
ok(await page.evaluate(() => { try { const j = JSON.parse(localStorage.getItem("racing3d-records-v1")); return !!j && Object.keys(j.time).length >= 1 && Object.keys(j.lap).length >= 1; } catch { return false; } }), "紀錄已存 localStorage");
// 回選單
await page.click("#resultMenuButton");
await page.waitForTimeout(500);
ok(await page.isVisible("#homeScreen.visible"), "回選單");

// ── v3(0907):方向變體 / 首頁紀錄 / 排行房掛鉤 / 暫停 ──
ok(await page.evaluate(() => document.querySelectorAll("#variantSelect option").length === 4), "方向選單 4 檔(正走/逆走/鏡像/鏡像逆走)");
await page.selectOption("#variantSelect", "rev");
await page.waitForTimeout(300);
const rev = await page.evaluate(() => ({ id: window.__racing3d.track.id, label: window.__racing3d.track.label }));
ok(rev.id === "meadow-rev" && /逆走/.test(rev.label), `逆走賽道 ${rev.id}「${rev.label}」`);
await page.screenshot({ path: OUT + "12-home-variant-rev.png" });
await page.selectOption("#variantSelect", { index: 0 });
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__racing3d.track.id === "meadow"), "切回正走");
const homeRec = await page.textContent("#homeRecord");
ok(/最佳/.test(homeRec) && !/undefined|NaN/.test(homeRec), `首頁紀錄「${homeRec.slice(0, 48)}」`);
ok(await page.evaluate(() => !!document.querySelector("script[data-hfpc-rank-game]")), "排行房 rank.js 掛鉤在 index.html");
// 暫停:0 對手開一場,跑起來按 P → 凍住;繼續 → 跑;Esc=暫停;蓋版「回選單」
await page.selectOption("#aiSelect", "0");
await page.click("#startButton");
await page.waitForTimeout(300);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(5000);
ok(await page.evaluate(() => window.__racing3d.phase === "racing"), "暫停測試:跑起來了");
ok(await page.isVisible("#pauseButton"), "比賽中 ⏸ 鈕可見");
await page.keyboard.press("p");
await page.waitForTimeout(200);
const ps1 = await page.evaluate(() => ({ paused: window.__racing3d.paused, t: window.__racing3d.raceT, x: window.__racing3d.player.x }));
ok(ps1.paused && await page.isVisible("#pauseOverlay.visible"), "P 鍵暫停、蓋版出現");
ok((await page.textContent("#pauseButton")).includes("繼續"), "⏸ 鈕變「▶ 繼續」");
await page.screenshot({ path: OUT + "13-pause.png" });
await page.waitForTimeout(700);
const ps2 = await page.evaluate(() => ({ t: window.__racing3d.raceT, x: window.__racing3d.player.x }));
ok(ps2.t === ps1.t && ps2.x === ps1.x, "暫停 0.7 秒:計時與車位都凍住");
await page.click("#pauseResumeButton");
await page.waitForTimeout(500);
const ps3 = await page.evaluate(() => ({ paused: window.__racing3d.paused, t: window.__racing3d.raceT }));
ok(!ps3.paused && ps3.t > ps1.t && !(await page.isVisible("#pauseOverlay.visible")), "繼續後計時前進、蓋版關閉");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__racing3d.paused), "Esc 在比賽中=暫停(不再直接作廢整場)");
await page.click("#pauseMenuButton");
await page.waitForTimeout(400);
ok(await page.isVisible("#homeScreen.visible") && await page.evaluate(() => !window.__racing3d.paused && window.__racing3d.phase === "menu"), "暫停蓋版「回選單」");
await page.selectOption("#aiSelect", "3");

// ── v4(0907):載具 賽車/摩托車/馬 ──
ok(await page.evaluate(() => document.querySelectorAll("#vehicleSelect option").length === 4), "載具選單 4 型(含懸浮車)");
ok(await page.evaluate(() => document.querySelectorAll("#aiVehicleSelect option").length === 5), "對手載具選單 5 檔(混搭 + 四型)");
// 0907 使用者:「對手要能選擇馬或摩托車或懸浮車」——指定後開一場,確認四台對手真的全是那一型
await page.selectOption("#aiVehicleSelect", "hover");
await page.selectOption("#aiSelect", "3");
await page.click("#startButton");
await page.waitForTimeout(400);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
const aiPick = await page.evaluate(() => { const g = window.__racing3d; return { kinds: [...new Set(g.cars.filter((c) => !c.isPlayer).map((c) => c.vehicle))], rigs: [...new Set(g.cars.filter((c) => !c.isPlayer).map((c) => g.rigs.get(c).kind))], me: g.player.vehicle }; });
ok(aiPick.kinds.length === 1 && aiPick.kinds[0] === "hover" && aiPick.rigs[0] === "hover", `指定懸浮車 ⇒ 對手全是懸浮車(${aiPick.kinds.join("/")})`);
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(4200);
await page.screenshot({ path: OUT + "28-ai-hover.png" });
ok(await page.evaluate(() => window.__racing3d.cars.every((c) => Number.isFinite(c.x) && Number.isFinite(c.speed))), "懸浮車對手跑起來、數值有限");
await page.click("#menuButton");
await page.waitForTimeout(400);
await page.selectOption("#aiVehicleSelect", "mix");
await page.waitForTimeout(200);
await page.selectOption("#vehicleSelect", "horse");
await page.waitForTimeout(400);
const menuRig = await page.evaluate(() => { const g = window.__racing3d; return { kind: g.rigs.get(g.player).kind, veh: g.player.vehicle, hint: document.getElementById("vehicleHint").textContent }; });
ok(menuRig.kind === "horse" && menuRig.veh === "horse" && /馬/.test(menuRig.hint), `選單選馬 ⇒ 展示車換馬(${menuRig.kind})`);
await page.screenshot({ path: OUT + "14-home-horse.png" });
await page.selectOption("#aiSelect", "3");
await page.click("#startButton");
await page.waitForTimeout(300);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(5200);
const mix = await page.evaluate(() => { const g = window.__racing3d; return { phase: g.phase, me: g.player.vehicle, ai: [...new Set(g.cars.filter((c) => !c.isPlayer).map((c) => c.vehicle))], label: document.getElementById("turboLabel").textContent }; });
ok(mix.phase === "racing" && mix.me === "horse", "騎馬開賽跑起來");
ok(mix.ai.length === 3, `AI 三種混搭 ${mix.ai.join("/")}`);
ok(/衝刺/.test(mix.label), `馬的加速條標「${mix.label}」`);
await page.keyboard.press("1");
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + "15-horse-chase.png" });
await page.keyboard.press("3");
await page.waitForTimeout(700);
const hc = await page.evaluate(() => { const g = window.__racing3d; const r = g.rigs.get(g.player); return { hidden: r.hide.map((m) => m.visible), y: g.camera.position.y - g.player.y, fin: [g.camera.position.x, g.camera.position.y, g.camera.position.z].every(Number.isFinite) }; });
ok(hc.fin && hc.hidden.every((v) => v === false) && hc.y > 2 && hc.y < 3.2, `馬背駕駛座:藏騎士頭身、眼高 ${hc.y.toFixed(2)}m`);
await page.screenshot({ path: OUT + "16-horse-cockpit.png" });
const hud4 = await page.evaluate(() => ["raceCard", "speedPanel", "statusMessage"].map((id) => document.getElementById(id).textContent).join(" | "));
ok(!/undefined|NaN/.test(hud4), "載具 HUD 無 undefined/NaN");
await page.click("#menuButton");
await page.waitForTimeout(400);
await page.selectOption("#vehicleSelect", "moto");
await page.waitForTimeout(300);
await page.click("#startButton");
await page.waitForTimeout(300);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(5200);
await page.keyboard.press("3");
await page.waitForTimeout(700);
const mc = await page.evaluate(() => { const g = window.__racing3d; const r = g.rigs.get(g.player); return { kind: r.kind, lean: r.tilt.rotation.z, hidden: r.hide.map((m) => m.visible), fin: [g.camera.position.x, g.camera.position.y, g.camera.position.z].every(Number.isFinite) }; });
ok(mc.kind === "moto" && mc.fin && mc.hidden.every((v) => v === false) && Math.abs(mc.lean) <= 0.46, `摩托車駕駛座:藏騎士、傾身 ${mc.lean.toFixed(2)} 有上限`);
await page.screenshot({ path: OUT + "17-moto-cockpit.png" });
await page.keyboard.press("1");
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "18-moto-chase.png" });
const badVis4 = await page.evaluate(() => { let bad = 0; window.__racing3d.scene.traverse((o) => { if (typeof o.visible !== "boolean") bad++; }); return bad; });
ok(badVis4 === 0, `載具場景 visible 全 boolean(壞 ${badVis4})`);
await page.click("#menuButton");
await page.waitForTimeout(400);
await page.selectOption("#vehicleSelect", "car");
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__racing3d.rigs.get(window.__racing3d.player).kind === "car"), "切回賽車");

// ── v5(0907):道具層 + 今日挑戰 ──
ok(await page.evaluate(() => document.querySelectorAll("#itemsSelect option").length === 2), "道具選單 2 檔");
const itemsInfo = await page.evaluate(() => { const g = window.__racing3d; const k = {}; for (const it of g.items) k[it.type] = (k[it.type] || 0) + 1; return { n: g.items.length, kinds: k, meshes: g.itemMeshes.size }; });
ok(itemsInfo.n > 5 && itemsInfo.meshes === itemsInfo.n, `選單期就有道具 ${itemsInfo.n} 個(mesh ${itemsInfo.meshes})`);
ok(Object.keys(itemsInfo.kinds).length >= 2, `種類 ${JSON.stringify(itemsInfo.kinds)}`);
await page.selectOption("#lapsSelect", "1");
await page.selectOption("#aiSelect", "3");
await page.click("#startButton");
await page.waitForTimeout(300);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(4500);
// 起跑線前後 40m 刻意沒放道具(edgeGap),真實時間 4.5 秒可能還沒跑到第一個 ⇒ 同步快轉 8 秒讓它真的壓過去
await page.evaluate(() => { const g = window.__racing3d; for (let i = 0; i < 60 * 8; i++) g.update(1 / 60); });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "19-items-track.png" });
const picked = await page.evaluate(() => { const g = window.__racing3d; return { mine: g.player.pickedIds ? g.player.pickedIds.size : 0, all: g.cars.reduce((s, c) => s + (c.pickedIds ? c.pickedIds.size : 0), 0), stars: g.player.stars, star: document.getElementById("starText").textContent, hidden: [...g.itemMeshes.values()].filter((m) => m.visible === false).length }; });
ok(picked.all > 0, `跑 6 秒全場撿到 ${picked.all} 個道具(我 ${picked.mine} 個)`);
ok(/^⭐ \d+$/.test(picked.star), `HUD 星星欄「${picked.star}」`);
ok(picked.hidden === picked.mine, `撿走的 ${picked.mine} 個 mesh 已藏起(visible 嚴格 false)`);
const itemHud = await page.evaluate(() => ["raceCard", "speedPanel", "statusMessage"].map((id) => document.getElementById(id).textContent).join(" | "));
ok(!/undefined|NaN/.test(itemHud), "道具 HUD 無 undefined/NaN");
const finItems = await page.evaluate(() => { const g = window.__racing3d; for (let i = 0; i < 60 * 240 && g.phase !== "finished"; i++) g.update(1 / 60); return { phase: g.phase, stars: g.results && g.results.stars, items: g.results && g.results.items }; });
ok(finItems.phase === "finished" && finItems.items === true && Number.isInteger(finItems.stars), `開道具完賽、結算星星 ${finItems.stars}`);
await page.waitForTimeout(1600);
ok(/星星/.test(await page.textContent("#recordText")), "結算有星星那行");
await page.screenshot({ path: OUT + "20-items-results.png" });
await page.click("#resultMenuButton");
await page.waitForTimeout(400);
// 關掉道具 ⇒ 場上清空
await page.selectOption("#itemsSelect", "off");
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__racing3d.items.length === 0 && window.__racing3d.itemMeshes.size === 0), "關道具 ⇒ 場上一個都沒有");
await page.selectOption("#itemsSelect", "on");
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__racing3d.items.length > 5), "開回來 ⇒ 道具又長出來");
// 今日挑戰:鈕 + 深連結
const dailyHint = await page.textContent("#dailyHint");
ok(/今日挑戰/.test(dailyHint) && !/undefined|NaN/.test(dailyHint), `首頁今日挑戰提示「${dailyHint.slice(0, 42)}」`);
await page.screenshot({ path: OUT + "21-home-daily.png" });
await page.click("#dailyButton");
await page.waitForTimeout(400);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
const daily = await page.evaluate(() => { const g = window.__racing3d; return { key: g.dailyKey, track: g.settings.trackId, laps: g.settings.laps, diff: g.settings.difficulty, ai: g.settings.aiCount, badge: !document.getElementById("dailyBadge").hidden }; });
ok(/^\d{4}-\d{2}-\d{2}$/.test(daily.key || ""), `今日挑戰開起來了 ${daily.key}`);
ok(daily.laps <= 3 && daily.diff !== "hard" && daily.ai <= 4, `今日題在課堂尺度 ${daily.laps}圈/${daily.diff}/${daily.ai}台`);
ok(daily.badge, "HUD 顯示今日挑戰徽章");
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + "22-daily-race.png" });
await page.click("#menuButton");
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__racing3d.dailyKey === null), "回選單清掉今日題標記");
// ?daily 深連結:零點擊直接開題
const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors2 = [];
page2.on("pageerror", (e) => errors2.push(String(e)));
await page2.goto(CHECK_URL.replace(/\/?$/, "/") + "?daily", { waitUntil: "load" });
await page2.waitForFunction(() => window.__racing3d && window.__racing3d.scene, null, { timeout: 15000 });
await page2.waitForTimeout(1500);
const deep = await page2.evaluate(() => ({ key: window.__racing3d.dailyKey, phase: window.__racing3d.phase, home: document.getElementById("homeScreen").classList.contains("visible") }));
ok(/^\d{4}-\d{2}-\d{2}$/.test(deep.key || "") && !deep.home, `?daily 深連結零點擊直接開題(${deep.key} / ${deep.phase})`);
ok(errors2.length === 0, `?daily 頁面 0 pageerror(${errors2.length})`);
await page2.screenshot({ path: OUT + "23-deeplink-daily.png" });
await page2.close();

// ── v2(0906):選單新選項 / 人聲 manifest / 雙人同機分割畫面 ──
ok(await page.isVisible("#modeSelect") && await page.isVisible("#assistSelect") && await page.isVisible("#gridSelect"), "選單有 模式/輔助/起跑格");
const voice = await page.evaluate(async () => { try { const r = await fetch("./voice/manifest.json"); const j = await r.json(); return { ok: r.ok, n: Object.keys(j).length }; } catch (e) { return { ok: false, n: 0 }; } });
ok(voice.ok && voice.n >= 20, `人聲 manifest 可讀(${voice.n} 句)`);
const mp3 = await page.evaluate(async () => { const j = await (await fetch("./voice/manifest.json")).json(); const p = Object.values(j)[0]; const r = await fetch("./" + p); return { status: r.status, type: r.headers.get("content-type") || "" }; });
ok(mp3.status === 200 && /audio|mpeg|octet/.test(mp3.type), `第一支 mp3 200(${mp3.type})`);
const diffLabel = await page.$eval("#difficultySelect option[value=hard]", (o) => o.textContent);
ok(/180 km\/h/.test(diffLabel), `職業檔標籤「${diffLabel}」= 180 km/h`);
// 雙人:選 duel2p、1 對手、開始
await page.selectOption("#modeSelect", "duel2p");
ok(await page.$eval("#colorSelect", (s) => s.disabled), "雙人模式車色選單鎖住");
await page.selectOption("#aiSelect", "1");
await page.click("#startButton");
await page.waitForTimeout(300);
if (await page.isVisible("#helpOverlay.visible")) await page.click("#helpCloseButton");
ok(await page.evaluate(() => window.__racing3d.is2P() && window.__racing3d.players.length === 2), "雙人開賽:兩台人類車");
ok(await page.evaluate(() => document.body.classList.contains("duel2p")), "body.duel2p");
await page.evaluate(() => { window.__racing3d.autopilot = true; });
await page.waitForTimeout(5500);
ok(await page.isVisible("#raceCard2") && await page.isVisible("#speedPanel2") && await page.isVisible("#seam"), "P2 HUD + 分割線可見");
await page.keyboard.press("3");   // P1 駕駛座
await page.keyboard.press("0");   // P2 視角循環(chase→hood)
await page.waitForTimeout(900);
const two = await page.evaluate(() => {
  const g = window.__racing3d;
  const r1 = g.rigs.get(g.players[0]), r2 = g.rigs.get(g.players[1]);
  return { v1: g.cams[0].view, v2: g.cams[1].view, hide1: r1.hide.map((m) => m.visible), hide2: r2.hide.map((m) => m.visible),
    fin: g.cams.every((c) => [c.camera.position.x, c.camera.position.y, c.camera.position.z, c.camera.fov].every(Number.isFinite)),
    aspect: g.cams[0].camera.aspect, w: g._vw, h: g._vh };
});
ok(two.v1 === "cockpit" && two.v2 === "hood", `P1 駕駛座 / P2 車頭(${two.v1}/${two.v2})`);
ok(two.hide1.every((v) => v === false) && two.hide2.every((v) => v === true), "還原後:P1 車艙藏、P2 車艙顯示(各自視窗規則)");
ok(two.fin && Math.abs(two.aspect - (two.w / 2) / two.h) < 1e-6, "兩鏡頭有限、各半長寬比");
await page.screenshot({ path: OUT + "10-duel2p-split.png" });
const hud2 = await page.evaluate(() => ["raceCard", "raceCard2", "speedPanel", "speedPanel2", "statusMessage", "viewTag"].map((id) => document.getElementById(id).textContent).join(" | "));
ok(!/undefined|NaN|Invalid/.test(hud2), "雙人 HUD 無 undefined/NaN");
ok(/P1/.test(hud2) && /P2/.test(hud2), "雙人 HUD 標 P1/P2");
// 真鍵盤:方向鍵只動 P2(P1 不動)
await page.evaluate(() => { window.__racing3d.autopilot = false; });
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(400);
const steer = await page.evaluate(() => ({ p1: window.__racing3d.input.steer, p2: window.__racing3d.input2.steer }));
await page.keyboard.up("ArrowRight");
ok(steer.p2 > 0.3 && Math.abs(steer.p1) < 0.01, `雙人:方向鍵只轉 P2(p1 ${steer.p1.toFixed(2)} / p2 ${steer.p2.toFixed(2)})`);
await page.evaluate(() => { window.__racing3d.autopilot = true; });
// 快轉到雙人結算
const fin2 = await page.evaluate(() => { const g = window.__racing3d; for (let i = 0; i < 60 * 300 && g.phase !== "finished"; i++) g.update(1 / 60); return { phase: g.phase, title: g.results && g.results.title }; });
ok(fin2.phase === "finished" && /P[12] 獲勝/.test(fin2.title || ""), `雙人快轉結算「${fin2.title}」`);
await page.waitForTimeout(1800);
ok(await page.isVisible("#resultOverlay.visible"), "雙人結算卡出現");
ok(!/undefined|NaN/.test(await page.textContent("#resultOverlay")), "雙人結算卡無 undefined/NaN");
await page.screenshot({ path: OUT + "11-duel2p-results.png" });
await page.click("#resultMenuButton");
await page.waitForTimeout(400);
ok(await page.isVisible("#homeScreen.visible") && !(await page.evaluate(() => document.body.classList.contains("duel2p"))), "回選單、duel2p class 移除");
await page.selectOption("#modeSelect", "solo");
// ── v6(0907):選單版面 —— 兩顆開始鈕在小螢幕也要看得到,且捲到底時不能蓋住任何內容 ──
// 由來:使用者在 3D 撞球回報「版本與簡歷收不起來,選單上面被遮住了」。racing3d 的形式是
// 「選單十個下拉 + 三段說明 + 簡歷 = 1543px,可視區只有 791px ⇒ 開始鈕三尺寸全看不到」。
// ★ 只驗「捲到底」:沒捲完時行動列本來就該浮在內容上(那是 sticky 的用途,已加漸層淡入)。
await page.click("#menuButton").catch(() => {});
await page.waitForTimeout(300);
for (const [vw, vh] of [[390, 844], [844, 390], [1280, 720]]) {
  await page.setViewportSize({ width: vw, height: vh });
  await page.waitForTimeout(350);
  const m = await page.evaluate(() => {
    const card = document.querySelector(".home-card"), act = document.querySelector(".home-actions");
    card.scrollTop = card.scrollHeight;
    const ab = act.getBoundingClientRect();
    const covered = [];
    for (const el of card.children) {
      if (el === act) continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      const ov = Math.min(ab.bottom, r.bottom) - Math.max(ab.top, r.top);
      if (ov > 1) covered.push((el.id || el.className || el.tagName) + " " + Math.round(ov) + "px");
    }
    const s = document.getElementById("startButton").getBoundingClientRect();
    const d = document.getElementById("dailyButton").getBoundingClientRect();
    return { covered, startOk: s.top >= 0 && s.bottom <= innerHeight, dailyOk: d.top >= 0 && d.bottom <= innerHeight };
  });
  ok(m.startOk && m.dailyOk, `${vw}×${vh} 開始鈕與今日挑戰鈕都看得到`);
  ok(m.covered.length === 0, `${vw}×${vh} 捲到底時行動列沒蓋住任何內容${m.covered.length ? "(" + m.covered.join(", ") + ")" : ""}`);
}
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(250);
ok(await page.evaluate(() => !document.querySelector(".ver-fold").open), "版本簡歷預設收合(不擠掉選單)");
ok(await page.evaluate(() => /版本 v\d+/.test(document.querySelector(".ver-fold > summary").textContent)), "收合時 summary 仍看得到版號");

ok(errors.length === 0, `0 pageerror(${errors.length})`);
for (const e of errors) console.log("   ", e);
await browser.close();
console.log(`browser-check: ${n - fails}/${n} 通過${fails ? "  ✗ 有紅燈" : ""}`);
process.exit(fails ? 1 : 0);
