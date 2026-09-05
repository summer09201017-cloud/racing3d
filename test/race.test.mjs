// race.test.mjs —— 整場比賽 headless(無 renderer、無 DOM)跑在 node:
//   ① 自動駕駛玩家 + 3 AI 跑完 2 圈、名次/結算合理、無例外
//   ② 躺平(不按鍵)3 分鐘:不當、不 NaN、會被溫柔救援、對手完賽後有鼓勵訊息
//   ③ 五檔視角每檔 30 幀:鏡頭無 NaN;駕駛座視角藏車艙、其他視角顯示;所有 mesh.visible 都是嚴格 boolean
//   ④ 設定驗證(亂值回預設)、換賽道重建場景、回選單
import assert from "node:assert/strict";
import { RacingGame, CAM_VIEWS, CAM_LABELS, CAR_COLORS, fmtTime, TRACK_IDS } from "../src/game.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const DT = 1 / 60;
const finiteVec = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// ① 自動駕駛完賽
{
  const g = new RacingGame({ headless: true });
  const events = [];
  g.onEvent = (t, d) => events.push({ t, d });
  g.autopilot = true;
  g.startRace({ trackId: "meadow", laps: 2, aiCount: 3, difficulty: "normal", colorIdx: 1 });
  ok(g.phase === "countdown", "開賽進倒數");
  ok(g.cars.length === 4, "1 玩家 + 3 AI");
  ok(new Set(g.cars.map((c) => c.colorIdx)).size === 4, "車色不重複");
  let t = 0;
  while (g.phase !== "finished" && t < 400) { g.update(DT); t += DT; }
  ok(g.phase === "finished", `自動駕駛在 ${t.toFixed(0)}s 內完賽`);
  ok(events.some((e) => e.t === "go"), "有 GO 事件");
  ok(events.filter((e) => e.t === "countdown").length === 3, "倒數 3 次");
  ok(events.some((e) => e.t === "lap" && e.d.final), "有最後一圈事件");
  const fin = events.find((e) => e.t === "finish");
  ok(fin && fin.d.rank >= 1 && fin.d.rank <= 4, `結算名次 ${fin && fin.d.rank}`);
  ok(fin.d.rows.length === 4 && fin.d.rows[0].rank === 1, "結算表 4 列且第一列是第 1 名");
  ok(fin.d.time > 40 && fin.d.time < 400, `完賽時間合理 ${fin.d.time.toFixed(1)}`);
  ok(g.player.lapTimes.length === 2, "兩圈都有單圈時間");
  ok(g.hud().lap === 2 && g.hud().laps === 2, "HUD 圈數封頂");
  ok(fmtTime(65.43) === "1:05.4", `fmtTime ${fmtTime(65.43)}`);
  console.log(`  (① 完賽 ${fin.d.time.toFixed(1)}s,名次 ${fin.d.rank}/4,最佳單圈 ${fmtTime(g.player.bestLap)})`);
  // 完賽後繼續跑 10 秒:AI 慢慢繞、不炸
  for (let i = 0; i < 600; i++) g.update(DT);
  ok(finiteVec(g.camPos) && finiteVec(g.camLook), "結算後鏡頭有限");
}

// ② 躺平 3 分鐘
{
  const g = new RacingGame({ headless: true });
  const events = [];
  g.onEvent = (t, d) => events.push({ t, d });
  g.startRace({ trackId: "snow", laps: 1, aiCount: 2, difficulty: "kids" });
  for (let i = 0; i < 60 * 180; i++) g.update(DT);
  ok(g.phase === "racing", "躺平仍在比賽中(不會被判輸)");
  ok(g.cars.filter((c) => !c.isPlayer).every((c) => c.finished), "兩台 AI 都完賽");
  ok(events.some((e) => e.t === "allaidone"), "對手都到了 ⇒ 有鼓勵事件");
  for (const c of g.cars) for (const [k, v] of Object.entries(c)) if (typeof v === "number") ok(Number.isFinite(v), `車 ${c.name}.${k} 有限`);
  ok(finiteVec(g.camPos) && finiteVec(g.camLook) && finiteVec(g.camUp), "鏡頭有限");
  const hud = g.hud();
  ok(hud.rank === 3 && hud.total === 3, `躺平者名次最後 ${hud.rank}/${hud.total}`);
  ok(hud.speedKmh === 0, "躺平速度 0");
  // 手動救援 API 不炸
  g.requestRescue();
  ok(g.player.speed === 0 && Math.abs(g.player.lateral) < 0.1, "requestRescue 放回中線");
}

// ③ 五檔視角
{
  const g = new RacingGame({ headless: true });
  g.autopilot = true;
  g.startRace({ trackId: "desert", laps: 1, aiCount: 1, difficulty: "easy" });
  for (let i = 0; i < 60 * 6; i++) g.update(DT);   // 過倒數、跑起來
  ok(g.phase === "racing", "跑起來了");
  const rig = g.rigs.get(g.player);
  ok(rig && rig.cockpit, "玩家車有車內組");
  for (const v of CAM_VIEWS) {
    ok(typeof CAM_LABELS[v] === "string" && CAM_LABELS[v].length > 0, `視角 ${v} 有中文名`);
    g.setCamView(v);
    for (let i = 0; i < 30; i++) g.update(DT);
    ok(finiteVec(g.camera.position) && Number.isFinite(g.camera.fov), `視角 ${v} 鏡頭有限`);
    ok(g.hud().camLabel === CAM_LABELS[v], `HUD 視角名 ${v}`);
    const hidden = rig.hide.every((m) => m.visible === false);
    const shown = rig.hide.every((m) => m.visible === true);
    if (v === "cockpit") ok(hidden, "駕駛座視角:車艙/窗/駕駛頭全藏(嚴格 false)");
    else ok(shown, `視角 ${v}:車艙顯示(嚴格 true)`);
    // 駕駛座:鏡頭在車內(離車心 < 2m)且 near 很小
    if (v === "cockpit") {
      const dx = g.camera.position.x - g.player.x, dz = g.camera.position.z - g.player.z;
      ok(Math.hypot(dx, dz) < 2, `駕駛座鏡頭在車內 ${Math.hypot(dx, dz).toFixed(2)}m`);
      ok(g.camera.near <= 0.05, "駕駛座 near ≤ 0.05");
    }
    if (v === "bird") ok(g.camera.position.y - g.player.y > 30, "俯瞰在高空");
    if (v === "chase") {
      const dx = g.camera.position.x - g.player.x, dz = g.camera.position.z - g.player.z;
      ok(Math.hypot(dx, dz) > 5 && Math.hypot(dx, dz) < 15, `追尾距離 ${Math.hypot(dx, dz).toFixed(1)}m`);
    }
  }
  // 全場景 visible 都是嚴格 boolean(0827 通則)
  let bad = 0, total = 0;
  g.scene.traverse((o) => { total++; if (typeof o.visible !== "boolean") bad++; });
  ok(bad === 0, `場景 ${total} 物件 visible 全 boolean(壞 ${bad})`);
  ok(rig.flame.visible === false || rig.flame.visible === true, "火焰 visible 是 boolean");
  // cycle 走一圈回到原點
  const start = g.camView;
  for (let i = 0; i < CAM_VIEWS.length; i++) g.cycleCamView();
  ok(g.camView === start, "cycleCamView 走一圈回原點");
  // 方向盤跟著轉向:steer>0 ⇒ wheel.rotation.z>0(對駕駛=順時鐘)
  g.autopilot = false; g.input = { throttle: 1, brake: 0, steer: 1, boost: false, handbrake: false };
  for (let i = 0; i < 30; i++) g.update(DT);
  ok(rig.cockpit.userData.wheel.rotation.z > 0.5, `方向盤右轉 rotation.z=${rig.cockpit.userData.wheel.rotation.z.toFixed(2)}`);
  ok(rig.wheels.filter((w) => w.front).every((w) => w.pivot.rotation.y < 0), "前輪往右偏(rotation.y<0)");
}

// ④ 設定驗證與換賽道
{
  const g = new RacingGame({ headless: true });
  g.startRace({ trackId: "nope", laps: 99, aiCount: 42, difficulty: "ultra", colorIdx: 123 });
  ok(g.settings.trackId === "meadow" && g.settings.laps === 3 && g.settings.aiCount === 3 && g.settings.difficulty === "easy", "亂值回預設");
  ok(g.settings.colorIdx >= 0 && g.settings.colorIdx < CAR_COLORS.length, "車色索引夾住");
  const scene1 = g.scene;
  g.backToMenu();
  ok(g.phase === "menu" && g.cars.length === 1 && g.player, "回選單只剩展示車");
  for (const id of TRACK_IDS) { g.setTrack(id); ok(g.scene !== scene1 && g.track.id === id, `換賽道 ${id} 重建場景`); }
  for (let i = 0; i < 30; i++) g.update(DT);
  ok(finiteVec(g.camera.position), "選單鏡頭有限");
  g.setPlayerColor(3);
  ok(g.rigs.get(g.player).paint.color.getHex() === CAR_COLORS[3].hex, "展示車即時換色");
}

console.log(`race.test: ${n} 項通過`);
