// v5.test.mjs —— 0907 v5:道具層(加速板/油漬/星星)+ 今日挑戰 ?daily
//   ① 生成:12 條賽道都有道具、種類齊、在路面內、同類有間隔、決定性、density=0 空、起跑線前後留白
//   ② 拾取:壓過去撿得到、橫向沒對上不撿、停著/倒退不撿、高速不穿透、每台車各自、過線重生
//   ③ 效果:加速板=免費渦輪(不扣燃料)、油漬=抓地變差會滑(但不失控)、星星=+1 且補渦輪
//   ④ AI:靠向加速板、閃開油漬
//   ⑤ 今日挑戰:同一天同題、不同天會變、範圍夾在課堂尺度、不含職業檔、?daily 正則
//   ⑥ 遊戲層:開/關道具都能完賽、結算與 HUD 帶星星、startDaily 套用當天設定
import assert from "node:assert/strict";
import { TRACKS, TRACK_IDS, buildTrack } from "../src/track.js";
import { DIFFICULTY, createCar, placeOnTrack, stepCar, emptyInput } from "../src/vehicle.js";
import { ITEM_TYPES, ITEM_IDS, ITEM_GEN, buildItems, stepItems, applyItem, respawnForCar, aiItemBias, oilGripMul, trackSeed } from "../src/items.js";
import { dailyKey, dailyChallenge, dailyRecordKey, wantsDaily, DAILY_LAPS, DAILY_DIFFS, DAILY_AI } from "../src/daily.js";
import { RacingGame } from "../src/game.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const DT = 1 / 60;
const meadow = buildTrack(TRACKS.meadow);
const cfg = DIFFICULTY.normal;

// ① 生成
{
  ok(ITEM_IDS.length === 3 && ITEM_IDS.every((k) => ITEM_TYPES[k].label && ITEM_TYPES[k].emoji && ITEM_TYPES[k].radius > 0), "三種道具都有名字/emoji/半徑");
  let totalAll = 0;
  for (const id of TRACK_IDS) {
    const t = buildTrack(TRACKS[id]);
    const items = buildItems(t, 1);
    totalAll += items.length;
    ok(items.length >= 6, `${id} 生出 ${items.length} 個道具`);
    const kinds = new Set(items.map((i) => i.type));
    ok(kinds.size >= 2, `${id} 至少兩種道具(${[...kinds].join("/")})`);
    for (const it of items) {
      ok(ITEM_TYPES[it.type], `${id} 種類合法 ${it.type}`);
      ok(Math.abs(it.lateral) <= t.halfW, `${id} ${it.type} 在路面內(橫向 ${it.lateral.toFixed(1)} ≤ 半寬 ${t.halfW})`);
      ok(it.dist >= ITEM_GEN.edgeGap && it.dist <= t.length - ITEM_GEN.edgeGap, `${id} 起跑線前後留白`);
      ok(Number.isFinite(it.x) && Number.isFinite(it.y) && Number.isFinite(it.z), `${id} 世界座標有限`);
    }
    ok(new Set(items.map((i) => i.id)).size === items.length, `${id} 道具 id 不重複`);
    // 同類間隔
    for (const type of ITEM_IDS) {
      const ds = items.filter((i) => i.type === type).map((i) => i.dist).sort((a, b) => a - b);
      for (let k = 1; k < ds.length; k++) ok(ds[k] - ds[k - 1] >= ITEM_GEN.minGap - 12, `${id} ${type} 間隔 ${(ds[k] - ds[k - 1]).toFixed(0)}m`);
    }
  }
  console.log(`  (① 12 條賽道共生成 ${totalAll} 個道具)`);
  // 決定性 + 密度
  const a = buildItems(meadow, 1), b = buildItems(meadow, 1);
  ok(JSON.stringify(a) === JSON.stringify(b), "同一條賽道生成結果一模一樣(決定性)");
  ok(buildItems(meadow, 0).length === 0, "density 0 = 沒有道具(關掉就是 v4 行為)");
  ok(buildItems(meadow, 0.4).length < a.length, "density 低 ⇒ 道具變少");
  const rev = buildItems(buildTrack(TRACKS["meadow-rev"]), 1);
  ok(JSON.stringify(rev.map((i) => i.dist)) !== JSON.stringify(a.map((i) => i.dist)), "逆走是另一條賽道 ⇒ 道具佈局不同");
  ok(trackSeed("meadow") !== trackSeed("meadow-rev") && trackSeed("meadow") === trackSeed("meadow"), "trackSeed 決定性且分得開");
  // 加速板在直線、油漬/星星在彎道
  const straightK = a.filter((i) => i.type === "boost").map((i) => Math.abs(meadow.samples[Math.round((i.dist / meadow.length) * meadow.N) % meadow.N].k));
  ok(straightK.every((k) => k < ITEM_GEN.straightK + 1e-6), "加速板都在直線段");
}

// ② 拾取
{
  const items = buildItems(meadow, 1);
  const star = items.find((i) => i.type === "star");
  const mk = (lat) => { const c = createCar(); placeOnTrack(c, meadow, star.dist - 12, lat); return c; };
  const drive = (car, seconds, throttle = 1) => {
    const hits = [];
    for (let t = 0; t < seconds; t += DT) {
      const prev = car.trackDist;
      stepCar(car, { ...emptyInput(), throttle, steer: Math.max(-0.3, Math.min(0.3, (star.lateral - car.lateral) * 0.08)) }, DT, cfg, meadow, { noRescue: true });
      hits.push(...stepItems(car, items, prev, meadow));
    }
    return hits;
  };
  const onLine = mk(star.lateral);
  const hits = drive(onLine, 6);
  ok(hits.some((h) => h.type === "star"), `對準壓過去撿得到星星(共撿 ${hits.length} 個)`);
  ok(onLine.stars >= 1, `星星計數 ${onLine.stars}`);
  const far = createCar(); placeOnTrack(far, meadow, star.dist - 12, star.lateral + 6);
  const farHits = [];
  for (let t = 0; t < 4; t += DT) { const prev = far.trackDist; stepCar(far, { ...emptyInput(), throttle: 1 }, DT, cfg, meadow, { noRescue: true }); farHits.push(...stepItems(far, items, prev, meadow)); }
  ok(!farHits.some((h) => h.item.id === star.id), "橫向差 6m ⇒ 沒撿到那顆星星");
  // 停著 / 倒退不吃
  const still = mk(star.lateral);
  const stillHits = [];
  for (let t = 0; t < 2; t += DT) { const prev = still.trackDist; stepCar(still, emptyInput(), DT, cfg, meadow, { noRescue: true }); stillHits.push(...stepItems(still, items, prev, meadow)); }
  ok(stillHits.length === 0, "停著不吃道具");
  // 高速不穿透:一幀跳很遠也要撿到(直接餵大 span)
  const fast = createCar(); placeOnTrack(fast, meadow, star.dist + 3, star.lateral);
  fast.pickedIds = new Set();
  const jumped = stepItems(fast, items, star.dist - 20, meadow);
  ok(jumped.some((h) => h.item.id === star.id), "一幀跨 23m 仍撿得到(區間判定,不會穿透)");
  // 每台車各自 + 過線重生
  const c1 = mk(star.lateral), c2 = mk(star.lateral);
  drive(c1, 6); drive(c2, 6);
  ok(c1.stars >= 1 && c2.stars >= 1, "兩台車各撿各的(不互搶)");
  const before = c1.pickedIds.size;
  ok(before > 0, "撿過的有記錄");
  respawnForCar(c1);
  ok(c1.pickedIds.size === 0 && c2.pickedIds.size === before, "過線只重生自己的,不影響別台");
}

// ③ 效果
{
  const car = createCar(); placeOnTrack(car, meadow, 100, 0);
  car.turbo = 0.5;
  applyItem(car, "star");
  ok(car.stars === 1 && car.turbo > 0.9 && car.tired === false, `星星:+1 顆、渦輪 0.5→${car.turbo.toFixed(2)}、解除喘息`);
  applyItem(car, "boost");
  ok(car.startBoostT >= ITEM_TYPES.boost.boostSeconds - 1e-9, "加速板:走完美起跑那條免費渦輪管線(startBoostT)");
  const t0 = car.turbo;
  applyItem(car, "boost");
  ok(car.turbo === t0, "加速板不扣燃料");
  applyItem(car, "oil");
  ok(car.oilT >= ITEM_TYPES.oil.slipSeconds - 1e-9 && oilGripMul(car) < 1, `油漬:oilT ${car.oilT}、抓地倍率 ${oilGripMul(car)}`);
  // 油漬讓車真的比較滑(同樣打方向,橫向滑移更大),但不會失控/停住
  const run = (oiled) => {
    const c = createCar(); placeOnTrack(c, meadow, 200, 0); c.speed = 22;
    if (oiled) c.oilT = 5;
    for (let t = 0; t < 0.8; t += DT) stepCar(c, { ...emptyInput(), throttle: 0.6, steer: 1 }, DT, cfg, meadow, { noRescue: true });
    return c;
  };
  const dry = run(false), wet = run(true);
  ok(Math.abs(wet.lat) > Math.abs(dry.lat) * 1.3, `油漬上滑移更大 ${Math.abs(wet.lat).toFixed(2)} vs ${Math.abs(dry.lat).toFixed(2)} m/s`);
  ok(Number.isFinite(wet.speed) && wet.speed > 5 && Number.isFinite(wet.heading), "油漬不失控:速度與朝向仍有限、車還在跑(溫柔規則)");
  // 倒數會歸零
  const fade = createCar(); placeOnTrack(fade, meadow, 100, 0); fade.oilT = 0.5; fade.speed = 10;
  for (let t = 0; t < 1; t += DT) stepCar(fade, { ...emptyInput(), throttle: 0.5 }, DT, cfg, meadow, { noRescue: true });
  ok(fade.oilT === 0 && oilGripMul(fade) === 1, "油漬會自己退掉");
}

// ④ AI 反應
{
  const items = buildItems(meadow, 1);
  const boost = items.find((i) => i.type === "boost");
  const oil = items.find((i) => i.type === "oil");
  const carAt = (d, lat) => { const c = createCar(); placeOnTrack(c, meadow, d, lat); c.pickedIds = new Set(); return c; };
  const b = aiItemBias(carAt(boost.dist - 15, -4), items, meadow, 34, 0.9);
  ok(Math.abs(b.lane) >= 0 && b.want === true, "前方有加速板 ⇒ AI 想吃");
  const o = aiItemBias(carAt(oil.dist - 12, oil.lateral), items, meadow, 34, 0.9);
  ok(o.lane !== 0 && Math.sign(o.lane) === -Math.sign(oil.lateral || 1), `前方有油漬 ⇒ AI 往反側閃(lane ${o.lane.toFixed(2)})`);
  const none = aiItemBias(carAt(boost.dist + 200, 0), [], meadow);
  ok(none.lane === 0 && none.want === false, "沒有道具 ⇒ 完全不影響(關掉道具就是 v4 的 AI)");
  const picked = carAt(boost.dist - 10, 0); picked.pickedIds.add(boost.id);
  const after = aiItemBias(picked, [boost], meadow, 34, 0.9);
  ok(after.lane === 0 && after.want === false, "已撿過的不再吸引 AI");
}

// ⑤ 今日挑戰
{
  ok(/^\d{4}-\d{2}-\d{2}$/.test(dailyKey()), "dailyKey 格式");
  ok(dailyKey(Date.UTC(2026, 8, 7, 16, 30)) === "2026-09-08", "台北時區換日線:UTC 16:30 已是隔天");
  ok(dailyKey(Date.UTC(2026, 8, 7, 15, 30)) === "2026-09-07", "UTC 15:30 還是當天");
  const a = dailyChallenge("2026-09-07"), b = dailyChallenge("2026-09-07"), c = dailyChallenge("2026-09-08");
  ok(JSON.stringify(a) === JSON.stringify(b), "同一天=同一題(全班一致)");
  ok(JSON.stringify(a) !== JSON.stringify(c), "換一天題目會變");
  const keys = ["2026-09-07", "2026-10-01", "2027-01-01", "2026-12-25", "2026-06-30"];
  const seen = new Set();
  for (const k of keys) {
    const d = dailyChallenge(k);
    seen.add(d.trackId);
    ok(TRACKS[d.trackId], `${k} 賽道合法 ${d.trackId}`);
    ok(DAILY_LAPS.includes(d.laps) && d.laps <= 3, `${k} 圈數 ${d.laps} ≤ 3(一堂課跑得完)`);
    ok(DAILY_DIFFS.includes(d.difficulty) && d.difficulty !== "hard", `${k} 難度 ${d.difficulty} 不是職業檔`);
    ok(DAILY_AI.includes(d.aiCount) && d.aiCount <= 4, `${k} 對手 ${d.aiCount} ≤ 4`);
    ok(d.mode === "solo" && d.gridPos === "last" && d.assist === "auto", `${k} 固定:單人/最後一排/輔助自動`);
    ok(typeof d.items === "boolean" && (d.itemDensity === 0 || d.itemDensity === 1), `${k} 道具開關一致`);
  }
  ok(seen.size >= 3, `五天抽到 ${seen.size} 種不同賽道(有變化)`);
  ok(dailyRecordKey("2026-09-07") === "daily|2026-09-07", "每日紀錄鍵");
  for (const s of ["?daily", "?daily=1", "?a=1&daily", "?daily&b=2"]) ok(wantsDaily(s), `wantsDaily 認得 ${s}`);
  for (const s of ["", "?dailyx", "?x=daily", "?nodaily=1"]) ok(!wantsDaily(s), `wantsDaily 不誤判 ${s}`);
}

// ⑥ 遊戲層
{
  const g = new RacingGame({ headless: true });
  ok(g.items.length > 0 && g.settings.items === true, `預設開道具(${g.items.length} 個)`);
  g.autopilot = true;
  g.startRace({ trackId: "meadow", laps: 2, aiCount: 3, difficulty: "normal", items: true });
  ok(g.items.length > 0, "開賽仍有道具");
  const evs = [];
  g.onEvent = (t, d) => evs.push({ t, d });
  let t = 0; while (g.phase !== "finished" && t < 400) { g.update(DT); t += DT; }
  ok(g.phase === "finished", `開道具能完賽(${t.toFixed(0)}s)`);
  const picked = g.cars.reduce((s, c) => s + (c.pickedIds ? c.pickedIds.size : 0), 0);
  ok(picked > 0, `全場共撿 ${picked} 個道具(自動駕駛也會壓到)`);
  ok(g.results.rows.every((r) => Number.isInteger(r.stars) && r.stars >= 0), "結算每列都有星星數");
  ok(Number.isInteger(g.results.stars) && g.results.items === true, "結算帶玩家星星與道具開關");
  ok(g.cars.every((c) => Number.isFinite(c.speed) && Number.isFinite(c.oilT) && c.oilT >= 0), "全場數值有限、油漬不會負");
  // 關掉道具 = v4 行為
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 1, difficulty: "easy", items: false });
  ok(g.items.length === 0 && g.itemMeshes.size === 0, "關道具 ⇒ 場上一個都沒有");
  let t2 = 0; while (g.phase !== "finished" && t2 < 300) { g.update(DT); t2 += DT; }
  ok(g.phase === "finished" && g.results.items === false && g.results.stars === 0, "關道具照樣完賽、星星 0");
  // 今日挑戰
  const g2 = new RacingGame({ headless: true }); g2.autopilot = true;
  const d = g2.startDaily("2026-09-07");
  ok(g2.dailyKey === "2026-09-07" && g2.hud().dailyKey === "2026-09-07", "startDaily 標記今日題");
  ok(g2.settings.trackId === d.trackId && g2.settings.laps === d.laps && g2.settings.difficulty === d.difficulty && g2.settings.aiCount === d.aiCount, "startDaily 套用當天設定");
  ok(g2.settings.mode === "solo" && g2.settings.gridPos === "last", "今日題固定單人+最後一排");
  let t3 = 0; while (g2.phase !== "finished" && t3 < 400) { g2.update(DT); t3 += DT; }
  ok(g2.phase === "finished" && g2.results.dailyKey === "2026-09-07", `今日題跑得完(${t3.toFixed(0)}s)、結算帶 dailyKey`);
  g2.startRace({ laps: 1, aiCount: 0 });
  ok(g2.dailyKey === null && g2.hud().dailyKey === null, "一般開賽會清掉今日題標記");
  g2.startDaily("2026-09-07");
  g2.backToMenu();
  ok(g2.dailyKey === null && g2.hud().dailyKey === null, "回選單也清掉今日題標記(0907 真瀏覽器驗收抓到的 bug)");
  // 載具沿用玩家選的、不被題目蓋掉
  const g3 = new RacingGame({ headless: true });
  g3.setVehicle("horse", 0);
  g3.startDaily("2026-09-07");
  ok(g3.player.vehicle === "horse", "今日題不強迫換載具(那是偏好不是題目)");
  let bad = 0; g3.scene.traverse((o) => { if (typeof o.visible !== "boolean") bad++; });
  ok(bad === 0, "道具場景 visible 全 boolean");
}

console.log(`v5.test: ${n} 項通過`);
