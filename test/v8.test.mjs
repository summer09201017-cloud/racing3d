// v8.test.mjs —— 0907 使用者第二批:甩尾計量 / 名次播報 / 年齡預設對應的四檔輔助 / 跑步載具
//   ① 甩尾純函數:累積門檻、獎勵秒數、上限、放開才結算、不滑不算、慢速不算
//   ② 遊戲層:甩尾事件走免費渦輪管線(燃料不扣)、開賽清空
//   ③ 名次播報:超車 / 被超車 / 衝進前三 各有唸稿且在 PHRASES 裡
//   ④ 輔助四檔:任何難度都能選任何一檔、強度單調遞增、舊存檔 on 平移
import assert from "node:assert/strict";
import { TRACKS, buildTrack } from "../src/track.js";
import { DIFFICULTY, createCar, placeOnTrack, stepCar, emptyInput, DRIFT, driftReward, assistStrength, ASSIST_MODES, ASSIST_LEVELS, ASSIST_LABELS } from "../src/vehicle.js";
import { phraseFor } from "../src/commentary.js";
import { PHRASES } from "../src/voicePhrases.js";
import { RacingGame } from "../src/game.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const DT = 1 / 60;
const meadow = buildTrack(TRACKS.meadow);
const cfg = DIFFICULTY.normal;

// ① 甩尾純函數
{
  ok(driftReward(0) === 0 && driftReward(DRIFT.need - 0.01) === 0, "累積不到門檻 ⇒ 不給獎勵(點一下手煞沒有用)");
  ok(driftReward(DRIFT.need) > 0, "剛好到門檻就給");
  ok(driftReward(DRIFT.maxHold * 5) === DRIFT.maxHold * DRIFT.secPer, "獎勵有上限(甩再久也不會無限長)");
  ok(driftReward(2) > driftReward(1.2), "甩越久獎勵越長");
  // 真的甩:高速 + 手煞 + 滿舵
  // ★ 甩尾要「邊跑邊記」:滿舵甩久了車會轉出去、lat 掉回門檻以下就當場結算,
  //   跑完才讀 car.drift 一定是 0(0907 實踩,查了才發現機制其實有效)。
  const drift = (opts) => {
    const c = createCar(); placeOnTrack(c, meadow, 200, 0); c.speed = 30;
    const evs = []; let peak = 0;
    for (let t = 0; t < 0.8; t += DT) {
      evs.push(...stepCar(c, { ...emptyInput(), throttle: 0.7, steer: 1, handbrake: true, ...opts }, DT, cfg, meadow, { noRescue: true }));
      peak = Math.max(peak, c.drift);
    }
    const held = c.drift;
    const rel = [];
    for (let t = 0; t < 0.2; t += DT) rel.push(...stepCar(c, { ...emptyInput(), throttle: 0.7 }, DT, cfg, meadow, { noRescue: true }));
    return { peak, held, evs, rel, car: c };
  };
  const d = drift({});
  ok(d.peak > 0, `按住手煞甩有累積(峰值 ${d.peak.toFixed(2)})`);
  const ev = [...d.evs, ...d.rel].find((e) => e.type === "drift");
  ok(ev && ev.seconds > 0, `結算成獎勵秒數 ${ev && ev.seconds.toFixed(2)} 秒`);
  ok(d.car.drift === 0, "結算後歸零");
  ok(d.held > 0, `放開前還握著累積 ${d.held.toFixed(2)}(不是甩完就沒了)`);
  // 不按手煞不算
  const noHand = createCar(); placeOnTrack(noHand, meadow, 200, 0); noHand.speed = 30;
  for (let t = 0; t < 1.6; t += DT) stepCar(noHand, { ...emptyInput(), throttle: 0.7, steer: 1 }, DT, cfg, meadow, { noRescue: true });
  ok(noHand.drift === 0, "沒按手煞 ⇒ 不累積(不是轉彎就給)");
  // 慢速按手煞不算
  const slow = createCar(); placeOnTrack(slow, meadow, 200, 0); slow.speed = 3;
  const slowEv = [];
  let slowPeak = 0;
  // 不給油(給了會加速衝過 6 m/s 的門檻,那就不是「低速」了——0907 實踩)
  for (let t = 0; t < 1.6; t += DT) { slowEv.push(...stepCar(slow, { ...emptyInput(), steer: 1, handbrake: true }, DT, cfg, meadow, { noRescue: true })); slowPeak = Math.max(slowPeak, slow.drift); }
  ok(slowPeak === 0 && !slowEv.some((e) => e.type === "drift"), `低速按手煞不算(原地磨不給獎勵;峰值 ${slowPeak}、末速 ${slow.speed.toFixed(1)}）`);
  ok(DRIFT.minLat > 0 && DRIFT.need > 0 && DRIFT.maxHold > DRIFT.need, "參數合理:有門檻、有上限");
}

// ② 遊戲層:甩尾走免費渦輪管線
{
  const g = new RacingGame({ headless: true });
  const evs = [];
  g.onEvent = (t, d) => evs.push({ t, d });
  g.startRace({ trackId: "meadow", laps: 2, aiCount: 0, difficulty: "normal", items: false });
  while (g.phase === "countdown") g.update(DT);
  for (let i = 0; i < 60 * 3; i++) { g.input.throttle = 1; g.update(DT); }   // 先加速
  // ★ 層次:物理(累不累積得到)已由 ① 的純函數驗過;遊戲層只驗「事件接線」——
  //   在遊戲層真的甩尾很難構造(車會撞牆、速度上不去,0907 debug 出來的),
  //   而且那樣測的其實還是同一支 stepCar,重複又脆弱。
  const turbo0 = g.player.turbo;
  g.player.startBoostT = 0;
  g._onCarEvent(g.player, { type: "drift", seconds: 1.25, charge: 2.9 });
  ok(g.player.startBoostT >= 1.25, `drift 事件 ⇒ 免費渦輪 ${g.player.startBoostT.toFixed(2)} 秒(走完美起跑那條管線)`);
  ok(g.player.turbo >= turbo0 - 1e-9, "燃料不扣(獎勵是免費的)");
  ok(g.player.driftPeak === 0, "結算後清掉峰值");
  const hit = evs.find((e) => e.t === "drift");
  ok(hit && hit.d.seconds === 1.25 && hit.d.charge === 2.9, "往外發同一份資料給 UI(秒數與累積量)");
  ok(/甩尾/.test(g.message), `字幕講了甩尾:「${g.message}」`);
  // 已經有渦輪時不會被縮短(取 max)
  g.player.startBoostT = 3;
  g._onCarEvent(g.player, { type: "drift", seconds: 0.5, charge: 1.2 });
  ok(g.player.startBoostT === 3, "已有更長的渦輪時不會被蓋短");
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 0 });
  ok(g.player.drift === 0 && g.player.driftPeak === 0 && g.player.lastRank === 0, "開賽清空甩尾與名次狀態");
  ok(Number.isFinite(g.hud().drift), "hud 帶 drift");
}

// ③ 名次播報
{
  for (const [type, key] of [["overtake", "超車"], ["overtaken", "被超"], ["top3", "前三"], ["drift", "甩尾"]]) {
    const line = phraseFor(type);
    ok(typeof line === "string" && line.length > 0, `${type} 有唸稿「${line}」`);
    ok(PHRASES.includes(line), `${type} 的唸稿在 PHRASES 裡(烤得出 mp3)`);
    ok(line.includes(key), `${type} 唸稿講的是${key}`);
  }
  // 真的跑一場有對手的,名次事件要發得出來
  const g = new RacingGame({ headless: true });
  const seen = new Set();
  g.onEvent = (t) => seen.add(t);
  g.autopilot = true;
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 5, difficulty: "normal", gridPos: "last", items: false });
  let t = 0; while (g.phase !== "finished" && t < 300) { g.update(DT); t += DT; }
  ok(seen.has("overtake") || seen.has("top3"), `從最後一排起跑會超車(事件:${[...seen].filter((x) => /overtake|top3|overtaken/.test(x)).join("/") || "無"})`);
  ok(g.players.every((p) => Number.isInteger(p.lastRank) && p.lastRank >= 1), "名次狀態有維護");
}

// ④ 輔助四檔
{
  ok(ASSIST_MODES.length === 5 && ["auto", "light", "medium", "strong", "off"].every((m) => ASSIST_MODES.includes(m)), `輔助五檔 ${ASSIST_MODES.join("/")}`);
  for (const m of ASSIST_MODES) ok(typeof ASSIST_LABELS[m] === "string" && ASSIST_LABELS[m].length >= 4, `${m} 有看得懂的中文名`);
  ok(ASSIST_LEVELS.light < ASSIST_LEVELS.medium && ASSIST_LEVELS.medium < ASSIST_LEVELS.strong, "輕 < 中 < 重");
  // ★ 使用者要求:任何難度都能選任何一檔
  for (const d of Object.keys(DIFFICULTY)) {
    for (const [m, want] of Object.entries(ASSIST_LEVELS)) ok(assistStrength(DIFFICULTY[d], m) === want, `${d} 檔選「${m}」= ${want}(難度不影響)`);
    ok(assistStrength(DIFFICULTY[d], "off") === 0, `${d} 檔可以完全關掉`);
    ok(assistStrength(DIFFICULTY[d], "auto") === (DIFFICULTY[d].assist || 0), `${d} 檔 auto = 該檔預設`);
  }
  ok(assistStrength(DIFFICULTY.hard, "strong") > assistStrength(DIFFICULTY.kids, "auto"), "職業檔選重重扶,比幼兒檔的自動還用力(真的所有難度都能用)");
  ok(assistStrength(DIFFICULTY.hard, "on") >= ASSIST_LEVELS.light, "舊存檔的 on 仍給得出強度(相容)");
  const g = new RacingGame({ headless: true });
  g.startRace({ difficulty: "hard", assist: "on", aiCount: 0, laps: 1 });
  ok(g.settings.assist === "light", "舊存檔的 on 在開賽時平移成 light");
  g.startRace({ difficulty: "kids", assist: "strong", aiCount: 0, laps: 1 });
  ok(g.assistStrength() === ASSIST_LEVELS.strong && g.hud().assist === ASSIST_LEVELS.strong, "幼兒檔也能選重重扶");
  g.startRace({ difficulty: "hard", assist: "strong", aiCount: 0, laps: 1 });
  ok(g.assistStrength() === ASSIST_LEVELS.strong, "職業檔也能選重重扶");
  // 重重扶真的比輕輕扶更會把車拉回中線
  const wander = (mode) => {
    const gg = new RacingGame({ headless: true });
    gg.startRace({ trackId: "meadow", laps: 1, aiCount: 0, difficulty: "kids", assist: mode, items: false });
    while (gg.phase === "countdown") gg.update(DT);
    let sum = 0, cnt = 0;
    for (let i = 0; i < 60 * 20; i++) { gg.input.throttle = 1; gg.update(DT); sum += Math.abs(gg.player.lateral); cnt++; }
    return sum / cnt;
  };
  const light = wander("light"), strong = wander("strong");
  ok(strong < light, `重重扶把車壓得更靠中線(平均偏離 ${strong.toFixed(2)}m vs 輕輕扶 ${light.toFixed(2)}m)`);
  console.log(`  (④ 只給油 20 秒的平均偏離:輕 ${light.toFixed(2)}m / 重 ${strong.toFixed(2)}m)`);
}

console.log(`v8.test: ${n} 項通過`);
