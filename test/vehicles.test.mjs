// vehicles.test.mjs —— v4 載具(0907):
//   ① 資料層:三型都有名字/emoji/外型/音色;賽車參數包 == CAR 逐鍵相同(舊測試逐位元不變的保證);摩托車/馬的取捨方向對
//   ② 物理:三型在大圓直線都到得了 ≥90% 極速(極速由難度管);馬在草地不減速、賽車會;摩托車同速轉得比賽車緊;車寬影響碰撞
//   ③ 零和平衡:同一條賽道自動駕駛跑 1 圈,三型完賽時間最快/最慢差 ≤ 10%
//   ④ 遊戲層:選單換載具重建展示車;開賽玩家用選的、AI 混搭(≥2 台一定不同種);雙人各自載具;三型 × 五視角鏡頭有限、駕駛座藏對的東西、visible 全 boolean;結算列帶載具 emoji
import assert from "node:assert/strict";
import { TRACKS, buildTrack } from "../src/track.js";
import { CAR, DIFFICULTY, createCar, placeOnTrack, stepCar, emptyInput, resolveCollisions } from "../src/vehicle.js";
import { VEHICLES, VEHICLE_IDS, AI_VEHICLE_MODES, AI_VEHICLE_LABELS, vehicleParams, aiVehicleFor } from "../src/vehicles.js";
import { RacingGame, CAM_VIEWS } from "../src/game.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const DT = 1 / 60;
const finiteVec = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const straight = buildTrack({ id: "circle", label: "測試大圓", ctrl: Array.from({ length: 16 }, (_, i) => [Math.cos(i / 16 * Math.PI * 2) * 500, Math.sin(i / 16 * Math.PI * 2) * 500]), halfW: 7, shoulder: 5, heightKeys: [[0, 0], [1, 0]] });
const cfg = DIFFICULTY.normal;
const follow = (car) => Math.max(-0.3, Math.min(0.3, -car.lateral * 0.08));
const run = (car, inputFn, seconds, trk, opts = {}) => { for (let t = 0; t < seconds; t += DT) stepCar(car, inputFn(car, t), DT, cfg, trk, opts); };
const mk = (vehicle, trk, dist, lat) => { const car = createCar({ vehicle, params: vehicleParams(vehicle) }); placeOnTrack(car, trk, dist, lat); return car; };

// ① 資料層
{
  ok(VEHICLE_IDS.length === 5 && ["car", "moto", "horse", "run", "hover"].every((id) => VEHICLE_IDS.includes(id)), "五型:car / moto / horse / run / hover");
  for (const id of VEHICLE_IDS) {
    const v = VEHICLES[id];
    ok(v.label && v.emoji && v.rig && v.sound && v.boostLabel && v.blurb && v.eye && v.hood, `${id} 資料齊(名字/emoji/外型/音色/衝刺名/說明/眼位)`);
    const p = vehicleParams(id);
    for (const k of Object.keys(CAR)) ok(Number.isFinite(p[k]), `${id} 參數 ${k} 有限`);
    ok(p.accelMul > 0 && p.gripMul > 0, `${id} accelMul/gripMul > 0`);
  }
  const pc = vehicleParams("car");
  for (const k of Object.keys(CAR)) ok(pc[k] === CAR[k], `賽車參數包 ${k} == CAR(舊測試逐位元不變)`);
  ok(pc.accelMul === 1 && pc.gripMul === 1, "賽車倍率 1");
  const pm = vehicleParams("moto"), ph = vehicleParams("horse");
  ok(pm.turnRate > pc.turnRate && pm.gripMul < 1 && pm.width < pc.width && pm.grassSpeedMul < pc.grassSpeedMul && pm.accelMul > 1, "摩托車:轉快 / 抓地差 / 窄 / 草地更慢 / 起步快(零和)");
  ok(ph.grassSpeedMul === 1 && ph.grassDrag === 0 && ph.cornerGrip > 1 && ph.accelMul < 1 && ph.turboBurn > pc.turboBurn, "馬:草地不減速 / 彎道穩 / 起步慢 / 衝刺耗快(零和)");
  ok(ph.gripMul <= 1, "★ 馬的全域抓地不高於賽車:它的價值是草地零減速(真人能切內側),不是全域最強——全域抓地高會讓它三條賽道都第一,那就成了正確答案而不是選擇");
  const pv = vehicleParams("hover");
  ok(pv.grassSpeedMul === 1 && pv.grassDrag === 0 && pv.slipGain > pc.slipGain && pv.gripMul < pc.gripMul && pv.turnRate > pc.turnRate, "懸浮車:草地不減速 / 轉向靈活 / 但很會漂、抓地差(零和)");
  ok(pv.straightAccel > 1.4 && pv.cornerGrip < 1, "懸浮車的主場是直線多的賽道(出彎回速最快、彎道最吃虧)");
  ok(pv.slipGain > pm.slipGain && pv.slipGain > pc.slipGain, "懸浮車比誰都會漂(難控感來自甩出去的量,不是抓地低——抓地太低只會單純變慢)");
  const pr = vehicleParams("run");
  ok(pr.turnRate > pm.turnRate && pr.width < pm.width && pr.grassSpeedMul === 1 && pr.grassDrag === 0, "跑步:轉最靈活、身體最窄、草地不減速");
  ok(pr.gripMul <= ph.gripMul, "跑步抓地不比馬好(三個優點疊起來太強,要用抓地付回去:grip 1.2 時它 43.3s 比誰都快)");
  ok(pr.cornerGrip > 1.3 && pr.straightAccel < 1, "跑步是彎道型:彎道加成最大、直線吃虧");
  ok(pm.cornerGrip > 1.3 && pm.straightAccel < 1, "摩托車也是彎道型");
  const pcc = vehicleParams("car");
  ok(pcc.straightAccel === 1 && pcc.cornerGrip === 1, "賽車是基準:兩個地形加成都是 1");
  ok(pr.accelMul < 1 && pr.turboBurn > pc.turboBurn * 1.4, "跑步的代價:起步慢、衝刺很快沒力(零和)");
  ok(vehicleParams("nope").turnRate === CAR.turnRate, "亂值回賽車");
  const set = new Set([0, 1, 2, 3, 4].map((i) => aiVehicleFor(i, 2)));
  ok(set.size === 5 && aiVehicleFor(0, 2) !== aiVehicleFor(1, 2), "AI 混搭:輪流拿、≥2 台不同種");
  // ★ 0907 使用者:「對手要能選擇馬或摩托車或懸浮車」⇒ 指定某型就全部同一型
  ok(AI_VEHICLE_MODES.length === 6 && AI_VEHICLE_MODES[0] === "mix", `對手載具 6 檔(混搭 + 五型)${AI_VEHICLE_MODES.join("/")}`);
  for (const m of AI_VEHICLE_MODES) ok(typeof AI_VEHICLE_LABELS[m] === "string" && AI_VEHICLE_LABELS[m].length > 0, `對手載具 ${m} 有中文名`);
  for (const id of VEHICLE_IDS) ok([0, 1, 2, 3, 4].every((i) => aiVehicleFor(i, 7, id) === id), `指定 ${id} ⇒ 五台對手全開 ${id}`);
  ok(new Set([0, 1, 2, 3, 4].map((i) => aiVehicleFor(i, 1, "mix"))).size === 5, "mix ⇒ 五台各不同");
  ok(aiVehicleFor(0, 1, "nope") === aiVehicleFor(0, 1, "mix"), "亂值當 mix");
}

// ② 物理
{
  for (const id of VEHICLE_IDS) {
    const car = mk(id, straight, 100, 0);
    run(car, (c) => ({ ...emptyInput(), throttle: 1, steer: follow(c) }), 8, straight);
    ok(car.speed > cfg.maxSpeed * 0.9 && car.speed <= cfg.maxSpeed + 0.01, `${id} 8 秒到 ≥90% 極速且不超過(${car.speed.toFixed(1)} / ${cfg.maxSpeed})`);
  }
  // 草地:馬放在路肩(lateral 9 > halfW 7)照跑接近極速;賽車掉到 ≤ 60%
  const horseGrass = mk("horse", straight, 100, 9), carGrass = mk("car", straight, 100, 9);
  const holdLane = (c) => Math.max(-0.3, Math.min(0.3, -(c.lateral - 9) * 0.08));
  run(horseGrass, (c) => ({ ...emptyInput(), throttle: 1, steer: holdLane(c) }), 8, straight);
  run(carGrass, (c) => ({ ...emptyInput(), throttle: 1, steer: holdLane(c) }), 8, straight);
  ok(horseGrass.offTrack && carGrass.offTrack, "兩台都在草地上");
  ok(horseGrass.speed > cfg.maxSpeed * 0.85, `馬在草地不減速(${horseGrass.speed.toFixed(1)})`);
  ok(carGrass.speed < cfg.maxSpeed * 0.6, `賽車在草地變慢(${carGrass.speed.toFixed(1)})`);
  // 轉向:同速滿舵 1 秒,摩托車轉的角度 > 賽車
  const turnOf = (id) => { const c = mk(id, straight, 100, 0); c.speed = 20; const h0 = c.heading; for (let t = 0; t < 1; t += DT) stepCar(c, { ...emptyInput(), throttle: 0.5, steer: 1 }, DT, cfg, straight, { noRescue: true }); let d = h0 - c.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); return d; };
  const tm = turnOf("moto"), tc = turnOf("car"), th = turnOf("horse");
  ok(tm > tc * 1.1 && tc > 0 && th > tc, `轉向:摩托車 ${tm.toFixed(2)} > 馬 ${th.toFixed(2)} > 賽車 ${tc.toFixed(2)} rad/s`);
  // 碰撞:兩台摩托車橫向差 1.2m 不碰(寬 0.9);兩台賽車 1.2m 會碰(寬 1.9)
  const twoAt = (id, gap) => { const a = mk(id, straight, 100, -gap / 2), b = mk(id, straight, 100, gap / 2); return resolveCollisions([a, b]).length; };
  ok(twoAt("moto", 1.2) === 0 && twoAt("car", 1.2) > 0, "車寬進碰撞:摩托車 1.2m 肩並肩不碰、賽車會碰");
  ok(twoAt("horse", 1.0) > 0 && twoAt("horse", 1.5) === 0, "馬寬 1.2:1.0m 碰、1.5m 不碰");
  // 摩托車撞牆掉更多速
  const wallOf = (id) => { const c = mk(id, straight, 100, 0); c.speed = 30; c.lateral = 0; for (let t = 0; t < 3; t += DT) stepCar(c, { ...emptyInput(), throttle: 1, steer: 1 }, DT, cfg, straight, { noRescue: true }); return c; };
  ok(Number.isFinite(wallOf("moto").speed) && Number.isFinite(wallOf("horse").speed), "撞牆後數值有限");
}

// ③ 零和平衡:草原 1 圈自動駕駛,三型完賽時間差 ≤ 10%
{
  const times = {};
  for (const id of VEHICLE_IDS) {
    const g = new RacingGame({ headless: true }); g.autopilot = true;
    g.startRace({ trackId: "meadow", laps: 1, aiCount: 0, difficulty: "normal", vehicle: id });
    let t = 0; while (g.phase !== "finished" && t < 300) { g.update(DT); t += DT; }
    ok(g.phase === "finished", `${id} 自動駕駛完賽`);
    times[id] = g.results.time;
  }
  const vals = Object.values(times), spread = Math.max(...vals) / Math.min(...vals);
  ok(spread <= 1.10, `三型完賽時間差 ${((spread - 1) * 100).toFixed(1)}% ≤ 10%(${Object.entries(times).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(" / ")})`);
  console.log(`  (③ 零和:${Object.entries(times).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(" / ")},差 ${((spread - 1) * 100).toFixed(1)}%)`);
}

// ③b 地形適性(0907 使用者拍板「每型給一個主場,不做絕對強弱」):
//   三條賽道的冠軍**不可以都是同一型**,而且不可以有任何一型三條全墊底 —— 那就是「有正確答案」,選單失去意義。
{
  const TR = ["meadow", "desert", "snow"];
  const rows = {};
  for (const v of VEHICLE_IDS) {
    rows[v] = {};
    for (const tr of TR) {
      const g = new RacingGame({ headless: true }); g.autopilot = true;
      g.startRace({ trackId: tr, laps: 1, aiCount: 0, difficulty: "normal", vehicle: v, items: false });
      let t = 0; while (g.phase !== "finished" && t < 400) { g.update(DT); t += DT; }
      ok(g.phase === "finished", `${v} 在 ${tr} 跑得完`);
      rows[v][tr] = g.results.time;
    }
  }
  const win = {}, lose = {};
  for (const tr of TR) {
    const sorted = VEHICLE_IDS.slice().sort((a, b) => rows[a][tr] - rows[b][tr]);
    win[tr] = sorted[0]; lose[tr] = sorted[sorted.length - 1];
    const ts = VEHICLE_IDS.map((v) => rows[v][tr]);
    ok(Math.max(...ts) / Math.min(...ts) <= 1.10, `${tr} 同賽道內五型差 ${((Math.max(...ts) / Math.min(...ts) - 1) * 100).toFixed(1)}% ≤ 10%`);
  }
  ok(new Set(Object.values(win)).size >= 2, `★ 冠軍不是固定同一型(${TR.map((tr) => tr + "=" + win[tr]).join(" / ")})`);
  for (const v of VEHICLE_IDS) ok(TR.filter((tr) => lose[tr] === v).length < 3, `${v} 不是三條賽道全墊底(選這型的孩子不會注定吊車尾)`);
  ok(win.desert === "hover", `★ 懸浮車的主場是沙漠(直線佔 51%):${rows.hover.desert.toFixed(1)}s 拿第一`);
  console.log(`  (③b 各賽道冠軍:${TR.map((tr) => tr + "=" + win[tr] + " " + rows[win[tr]][tr].toFixed(1) + "s").join(" / ")})`);
}
// ④ 遊戲層
{
  const g = new RacingGame({ headless: true });
  ok(g.player && g.player.vehicle === "car" && g.rigs.get(g.player).kind === "car", "預設展示車=賽車");
  g.setVehicle("horse", 0);
  ok(g.settings.vehicle === "horse" && g.player.vehicle === "horse" && g.rigs.get(g.player).kind === "horse", "選單換載具重建展示車(馬)");
  ok(g.player.params.grassDrag === 0, "展示車帶參數包");
  g.setVehicle("nope", 0);
  ok(g.settings.vehicle === "car", "亂值回賽車");
  g.setPlayerColor(4);
  ok(g.rigs.get(g.player).paint.color.getHex() === 0x8e24aa, "換色仍走 paint 材質");
  for (let i = 0; i < 30; i++) g.update(DT);
  ok(finiteVec(g.camera.position), "選單鏡頭有限");

  g.autopilot = true;
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 5, difficulty: "normal", vehicle: "moto" });
  ok(g.player.vehicle === "moto" && g.rigs.get(g.player).kind === "moto", "開賽玩家用選的載具");
  const aiKinds = new Set(g.cars.filter((c) => !c.isPlayer).map((c) => c.vehicle));
  ok(aiKinds.size === 5, `AI 5 台混搭五型 ${[...aiKinds].join("/")}`);
  // 指定對手載具:全部同一型
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 4, difficulty: "normal", vehicle: "car", aiVehicle: "hover" });
  ok(g.cars.filter((c) => !c.isPlayer).every((c) => c.vehicle === "hover"), "指定懸浮車 ⇒ 四台對手全是懸浮車");
  ok(g.player.vehicle === "car", "指定對手載具不影響玩家自己選的");
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 3, difficulty: "normal", aiVehicle: "horse" });
  ok(g.cars.filter((c) => !c.isPlayer).every((c) => c.vehicle === "horse") && g.cars.filter((c) => !c.isPlayer).every((c) => c.params.grassDrag === 0), "指定馬 ⇒ 三台都吃馬的參數");
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 3, difficulty: "normal", aiVehicle: "nope" });
  ok(g.settings.aiVehicle === "mix", "對手載具亂值回 mix");
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 5, difficulty: "normal", vehicle: "moto", aiVehicle: "mix" });
  ok(g.cars.every((c) => c.params && Number.isFinite(c.params.width)), "每台車都有參數包");
  for (let i = 0; i < 60 * 6; i++) g.update(DT);
  ok(g.phase === "racing" && g.cars.every((c) => Number.isFinite(c.x) && Number.isFinite(c.speed)), "混搭跑起來、數值有限");
  const rig = g.rigs.get(g.player);
  ok(rig.wheels.length === 2 && rig.wheels[0].front, "摩托車兩輪、前輪轉向");
  ok(Math.abs(rig.tilt.rotation.z) <= 0.46, `摩托車傾身有上限 ${rig.tilt.rotation.z.toFixed(2)}`);
  // 三型 × 五視角
  for (const id of VEHICLE_IDS) {
    g.startRace({ trackId: "meadow", laps: 1, aiCount: 1, difficulty: "easy", vehicle: id });
    for (let i = 0; i < 60 * 5; i++) g.update(DT);
    const r = g.rigs.get(g.player);
    ok(r.kind === VEHICLES[id].rig && r.hide.length > 0 && r.cockpit, `${id} rig 有 hide 清單與駕駛座殼`);
    for (const v of CAM_VIEWS) {
      g.setCamView(v, 0);
      for (let i = 0; i < 20; i++) g.update(DT);
      ok(finiteVec(g.camera.position) && Number.isFinite(g.camera.fov), `${id} 視角 ${v} 鏡頭有限`);
      if (v === "cockpit") {
        ok(r.hide.every((m) => m.visible === false), `${id} 駕駛座藏頭/身體(嚴格 false)`);
        const dx = g.camera.position.x - g.player.x, dz = g.camera.position.z - g.player.z;
        ok(Math.hypot(dx, dz) < 2 && g.camera.position.y - g.player.y > 1 && g.camera.position.y - g.player.y < 3.2, `${id} 駕駛座眼位在載具上(高 ${(g.camera.position.y - g.player.y).toFixed(2)}m)`);
      } else ok(r.hide.every((m) => m.visible === true), `${id} 視角 ${v} 全顯示`);
    }
    let bad = 0; g.scene.traverse((o) => { if (typeof o.visible !== "boolean") bad++; });
    ok(bad === 0, `${id} 場景 visible 全 boolean`);
    if (r.anim) { const y0 = r.tilt.position.y; ok(Number.isFinite(y0), `${id} 奔跑動畫數值有限`); }
    // 手動右轉:駕駕座殼的轉向物件會動(賽車方向盤 z / 馬韁 y);摩托車把手在前叉
    g.setCamView("cockpit", 0); g.autopilot = false; g.input = { throttle: 1, brake: 0, steer: 1, boost: false, handbrake: false };
    for (let i = 0; i < 30; i++) g.update(DT);
    const { wheel, wheelAxis } = r.cockpit.userData;
    if (id === "car") ok(wheel.rotation.z > 0.5, "賽車方向盤右轉");
    if (id === "horse") ok(Math.abs(wheel.rotation.y) > 0.1, `馬韁隨轉向動 ${wheel.rotation.y.toFixed(2)}`);
    if (id === "moto") ok(r.wheels[0].pivot.rotation.y < -0.2 && wheelAxis === "z", `摩托車前叉連把手右轉 ${r.wheels[0].pivot.rotation.y.toFixed(2)}`);
    g.autopilot = true;
  }
  // 雙人各自載具 + 結算列帶 emoji
  const g2 = new RacingGame({ headless: true }); g2.autopilot = true;
  g2.startRace({ mode: "duel2p", trackId: "meadow", laps: 1, aiCount: 1, difficulty: "normal", vehicle: "horse", vehicle2: "moto" });
  ok(g2.players[0].vehicle === "horse" && g2.players[1].vehicle === "moto", "雙人:P1 馬 / P2 摩托車");
  let t = 0; while (g2.phase !== "finished" && t < 400) { g2.update(DT); t += DT; }
  ok(g2.phase === "finished" && g2.results.rows.every((r) => typeof r.vehicleEmoji === "string" && r.vehicleEmoji.length > 0), "結算列每列帶載具 emoji");
  const h = g2.hud();
  ok(h.vehicle === "horse" && h.p2.vehicle === "moto", "hud 帶雙人載具");
  const g3 = new RacingGame({ headless: true });
  g3.startRace({ vehicle: "banana", vehicle2: 42 });
  ok(g3.settings.vehicle === "car" && g3.settings.vehicle2 === "car", "亂值回賽車");
}

console.log(`vehicles.test: ${n} 項通過`);
