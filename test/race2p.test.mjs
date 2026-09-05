// race2p.test.mjs —— 0906 新功能 headless(無 renderer):雙人同機分割畫面 / 起跑格 / 「AI 輕扶回中」開關 / 極速表
import assert from "node:assert/strict";
import { RacingGame, P1_COLOR, P2_COLOR, DIFFICULTY } from "../src/game.js";
import { assistStrength } from "../src/vehicle.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const DT = 1 / 60;
const finiteVec = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// ① 雙人同機:兩台人類車、鐵則色、同一排起跑、兩人都過線才結算、有勝者
{
  const g = new RacingGame({ headless: true });
  const events = [];
  g.onEvent = (t, d) => events.push({ t, d });
  g.autopilot = true;
  g.startRace({ mode: "duel2p", trackId: "meadow", laps: 1, aiCount: 1, difficulty: "normal", colorIdx: 3 });
  ok(g.is2P(), "is2P 單閘門");
  ok(g.players.length === 2 && g.cars.length === 3, "2 人類 + 1 AI");
  ok(g.players[0].colorIdx === P1_COLOR && g.players[1].colorIdx === P2_COLOR, "P1 藍 P2 紅(車色選單在雙人不生效)");
  ok(g.players[0].playerIdx === 0 && g.players[1].playerIdx === 1 && g.players.every((p) => p.isPlayer), "playerIdx 0/1 皆 isPlayer");
  const ai = g.cars.find((c) => !c.isPlayer);
  ok(ai.colorIdx !== P1_COLOR && ai.colorIdx !== P2_COLOR, "AI 不撞人類色");
  const [p1, p2] = g.players;
  ok(p1.progress === p2.progress, "P1 P2 同一排");
  ok(p1.lateral < 0 && p2.lateral > 0, "P1 左格、P2 右格(跟分割畫面左右一致)");
  ok(ai.progress > p1.progress, "AI 在前(玩家排最後)");
  const h0 = g.hud();
  ok(h0.two && h0.p2 && Number.isFinite(h0.p2.speedKmh) && h0.p2.camLabel.length > 0, "hud.p2 存在且有限");
  let t = 0;
  while (g.phase !== "finished" && t < 400) { g.update(DT); t += DT; }
  ok(g.phase === "finished", `雙人在 ${t.toFixed(0)}s 內結算`);
  ok(events.some((e) => e.t === "playerfinish"), "先過線者有 playerfinish 事件(還沒結算)");
  const fin = events.find((e) => e.t === "finish");
  ok(fin && fin.d.mode === "duel2p" && (fin.d.winner === 0 || fin.d.winner === 1), "結算有 winner");
  ok(/^P[12] 獲勝!/.test(fin.d.title), `title「${fin.d.title}」`);
  ok(fin.d.rank >= 1 && fin.d.rank2 >= 1 && fin.d.rank !== fin.d.rank2, `兩人名次不同 ${fin.d.rank}/${fin.d.rank2}`);
  ok((fin.d.winner === 0) === (fin.d.rank < fin.d.rank2), "winner = 名次較前者");
  ok(Number.isFinite(fin.d.time) && Number.isFinite(fin.d.time2) && fin.d.time > 0 && fin.d.time2 > 0, "兩人都有完賽時間");
  ok(fin.d.rows.filter((r) => r.isPlayer).length === 2, "結算表兩列人類");
  for (const cs of g.cams) ok(finiteVec(cs.camera.position) && Number.isFinite(cs.camera.fov), "視窗鏡頭有限");
  ok(g.camera === g.cams[0].camera && g.camPos === g.cams[0].pos, "相容別名 camera/camPos = cams[0]");
  console.log(`  (① 雙人 ${t.toFixed(1)}s 結算:${fin.d.title};P1 ${fin.d.time.toFixed(1)}s / P2 ${fin.d.time2.toFixed(1)}s)`);
}

// ② 雙人:P2 選駕駛座只藏 P2 的車艙、P1 照常;render 每一刀的規則;各半長寬比;P2 視角/救援 API
{
  const g = new RacingGame({ headless: true });
  g.autopilot = true;
  g.startRace({ mode: "duel2p", laps: 1, aiCount: 0, difficulty: "easy" });
  for (let i = 0; i < 60 * 5; i++) g.update(DT);
  const r1 = g.rigs.get(g.players[0]), r2 = g.rigs.get(g.players[1]);
  ok(r1.cockpit && r2.cockpit, "兩台人類車都有車內組");
  g.setCamView("chase", 0); g.setCamView("cockpit", 1);
  for (let i = 0; i < 10; i++) g.update(DT);
  ok(r2.hide.every((m) => m.visible === false), "P2 駕駛座:P2 車艙藏(嚴格 false)");
  ok(r1.hide.every((m) => m.visible === true), "P1 追尾:P1 車艙顯示(嚴格 true)");
  ok(g.hud().p2.camView === "cockpit" && g.hud().camView === "chase", "hud 各自視角");
  g._applyCockpitHide(0); ok(r2.hide.every((m) => m.visible === true), "畫 P1 視窗那一刀:P2 的車艙要看得到");
  g._applyCockpitHide(1); ok(r2.hide.every((m) => m.visible === false) && r1.hide.every((m) => m.visible === true), "畫 P2 視窗那一刀:只藏 P2 車艙");
  g._applyCockpitHide(-1); ok(r2.hide.every((m) => m.visible === false) && r1.hide.every((m) => m.visible === true), "還原各自規則");
  const c2 = g.cams[1].camera, q = g.players[1];
  ok(Math.hypot(c2.position.x - q.x, c2.position.z - q.z) < 2 && c2.near <= 0.05, "P2 駕駛座鏡頭在 P2 車內、near 0.05");
  ok(Math.abs(g.cams[0].camera.aspect - (1280 / 2) / 720) < 1e-6 && Math.abs(g.cams[1].camera.aspect - g.cams[0].camera.aspect) < 1e-9, "雙人各半長寬比");
  g.cycleCamView(1); ok(g.cams[1].view === "bird", "P2 cycle 到下一檔(cockpit→bird)");
  g.autopilot = false; g.input2 = { throttle: 1, brake: 0, steer: 1, boost: false, handbrake: false };
  for (let i = 0; i < 30; i++) g.update(DT);
  ok(r2.cockpit.userData.wheel.rotation.z > 0.5, "P2 的方向盤吃 input2(右轉)");
  g.autopilot = true;
  g.requestRescue(1); ok(Math.abs(g.players[1].lateral) < 0.1 && g.players[1].speed === 0, "P2 手動救援");
  let bad = 0; g.scene.traverse((o) => { if (typeof o.visible !== "boolean") bad++; }); ok(bad === 0, "場景 visible 全 boolean");
  g.backToMenu(); ok(!g.is2P() && g.players.length === 1 && Math.abs(g.cams[0].camera.aspect - 1280 / 720) < 1e-6, "回選單=單人展示車、長寬比復原");
}

// ③ 起跑格:front 玩家最前;last 維持舊行為;獨占一排置中;雙人一定同排;亂值回預設
{
  // 一排兩台 ⇒ 會有一台 AI 與玩家同排(progress 相同),所以判準是「玩家在最前/最後那一排」,不是嚴格大於
  const rows = (g) => g.cars.map((c) => c.progress);
  const g = new RacingGame({ headless: true });
  g.startRace({ gridPos: "front", aiCount: 3, laps: 1 });
  ok(g.player.progress === Math.max(...rows(g)), "front:玩家在最前排");
  ok(g.cars.filter((c) => !c.isPlayer).some((a) => a.progress < g.player.progress), "front:後面真的有 AI");
  const g2 = new RacingGame({ headless: true });
  g2.startRace({ gridPos: "last", aiCount: 3, laps: 1 });
  ok(g2.player.progress === Math.min(...rows(g2)), "last:玩家在最後一排");
  ok(g2.cars.filter((c) => !c.isPlayer).some((a) => a.progress > g2.player.progress), "last:前面真的有 AI");
  const g3 = new RacingGame({ headless: true });
  g3.startRace({ gridPos: "last", aiCount: 2, laps: 1 });
  ok(Math.abs(g3.player.lateral) < 0.01, "last 且獨占最後一排 ⇒ 置中");
  const g4 = new RacingGame({ headless: true });
  g4.startRace({ mode: "nope", assist: "??", gridPos: "middle" });
  ok(g4.settings.mode === "solo" && g4.settings.assist === "auto" && g4.settings.gridPos === "last", "亂值回預設");
  const g5 = new RacingGame({ headless: true });
  g5.startRace({ mode: "duel2p", gridPos: "front", aiCount: 3 });
  ok(g5.players[0].progress === g5.players[1].progress && g5.cars.filter((c) => !c.isPlayer).every((a) => a.progress < g5.players[0].progress), "雙人 front:同排在最前");
  const g6 = new RacingGame({ headless: true });
  g6.startRace({ mode: "duel2p", gridPos: "last", aiCount: 3 });
  ok(g6.players[0].progress === g6.players[1].progress && g6.cars.filter((c) => !c.isPlayer).every((a) => a.progress > g6.players[0].progress), "雙人 last、AI 奇數台:仍同排在最後");
  const g7 = new RacingGame({ headless: true });
  g7.startRace({ mode: "duel2p", gridPos: "last", aiCount: 3 });
  const lone = g7.cars.filter((c) => !c.isPlayer).sort((a, b) => a.progress - b.progress)[0];
  ok(Math.abs(lone.lateral) < 0.01, "奇數 AI 的最後一台獨占一排 ⇒ 置中");
}

// ④ 「AI 輕扶回中」開關:三態語意;職業檔也能開;幼兒檔可關;hud.assist
{
  ok(assistStrength(DIFFICULTY.hard, "auto") === 0, "職業 auto=0");
  ok(assistStrength(DIFFICULTY.hard, "on") >= 0.35, "職業 on ≥ 0.35(輕輕的)");
  ok(assistStrength(DIFFICULTY.kids, "off") === 0, "幼兒 off=0");
  ok(assistStrength(DIFFICULTY.kids, "on") === DIFFICULTY.kids.assist && DIFFICULTY.kids.assist >= 0.8, "幼兒 on=該檔預設(0.85 更保母)");
  const g = new RacingGame({ headless: true });
  g.startRace({ difficulty: "hard", assist: "on", aiCount: 0, laps: 1 });
  ok(g.assistStrength() >= 0.35 && g.hud().assist >= 0.35, "職業檔也能開輔助");
  g.startRace({ difficulty: "kids", assist: "off", aiCount: 0, laps: 1 });
  ok(g.assistStrength() === 0 && g.hud().assist === 0, "幼兒檔可關輔助");
  g.startRace({ difficulty: "easy", assist: "auto", aiCount: 0, laps: 1 });
  ok(g.assistStrength() === DIFFICULTY.easy.assist, "auto 照難度");
}

// ⑤ 極速表(0906 使用者要更快):遞增、幼兒 86 / 職業 180 km/h、AI 極速略低於玩家
{
  const ids = Object.keys(DIFFICULTY);
  for (let i = 1; i < ids.length; i++) ok(DIFFICULTY[ids[i]].maxSpeed > DIFFICULTY[ids[i - 1]].maxSpeed, `極速遞增 ${ids[i]}`);
  ok(Math.round(DIFFICULTY.kids.maxSpeed * 3.6) === 86 && Math.round(DIFFICULTY.hard.maxSpeed * 3.6) === 180, "幼兒 86 / 職業 180 km/h");
  for (const id of ids) ok(DIFFICULTY[id].aiMax < DIFFICULTY[id].maxSpeed, `${id} AI 極速 < 玩家極速`);
}

console.log(`race2p.test: ${n} 項通過`);
