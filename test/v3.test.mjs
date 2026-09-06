// v3.test.mjs —— 0907 v3 headless(無 renderer):
//   ① 暫停(倒數/比賽可暫停、整個世界凍住、選單/結算不能、開賽/回選單清除)
//   ② 完美起跑規則(GO 後踩=加速;「1」才踩也算;「2」就按住不算;太早不罰;AI 依技巧機率;雙人各自判)
//   ③ 本機最佳紀錄純函數(不改原物件、更慢不覆寫、單圈與總時間各自 key、變體/難度分開、亂值正規化、本地日期)
//   ④ 方向變體能開賽並完賽、結算帶 trackId/difficultyId/trackLength
//   ⑤ 播報新句對賬
import assert from "node:assert/strict";
import { RacingGame, PERFECT_START, TRACKS, VARIANT_LABELS, trackIdOf } from "../src/game.js";
import { applyResult, getRecord, emptyRecords, normalizeRecords, lapKey, timeKey, todayStr } from "../src/records.js";
import { phraseFor } from "../src/commentary.js";
import { PHRASES } from "../src/voicePhrases.js";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const DT = 1 / 60;
const steps = (g, s) => { for (let i = 0; i < Math.round(s / DT); i++) g.update(DT); };

// ① 暫停
{
  const g = new RacingGame({ headless: true });
  const events = [];
  g.onEvent = (t) => events.push(t);
  ok(g.setPaused(true) === false && !g.paused, "選單期不能暫停");
  g.autopilot = true;
  g.startRace({ trackId: "meadow", laps: 1, aiCount: 2, difficulty: "normal" });
  ok(g.setPaused(true) === true && g.paused && g.hud().paused === true, "倒數中可暫停、hud.paused");
  const cd0 = g.countdownT;
  steps(g, 1);
  ok(g.countdownT === cd0 && g.phase === "countdown", "暫停 1 秒:倒數不動");
  g.setPaused(false);
  steps(g, 6);
  ok(g.phase === "racing" && g.raceT > 1, "繼續後倒數結束、比賽開跑");
  const snap = () => ({ t: g.raceT, cars: g.cars.map((c) => [c.x, c.z, c.progress, c.speed]), cam: g.camera.position.toArray() });
  const a = snap();
  g.togglePause();
  ok(g.paused && events.includes("pause"), "togglePause → paused + pause 事件");
  steps(g, 2);
  const b = snap();
  ok(b.t === a.t && JSON.stringify(b.cars) === JSON.stringify(a.cars) && JSON.stringify(b.cam) === JSON.stringify(a.cam), "暫停 2 秒:計時、所有車、鏡頭全凍住");
  g.togglePause();
  ok(!g.paused && events.includes("resume"), "再 toggle → resume 事件");
  steps(g, 1);
  ok(g.raceT > a.t + 0.9, "繼續後計時前進");
  ok(g.setPaused(true) === true && g.setPaused(true) === true, "重複 setPaused(true) 冪等");
  g.backToMenu();
  ok(!g.paused && g.phase === "menu", "回選單清除暫停");
  g.startRace({ laps: 1, aiCount: 0 });
  g.setPaused(true);
  g.startRace({ laps: 1, aiCount: 0 });
  ok(!g.paused, "重新開賽清除暫停");
  const g2 = new RacingGame({ headless: true }); g2.autopilot = true;
  g2.startRace({ trackId: "meadow", laps: 1, aiCount: 0, difficulty: "hard" });
  let t = 0; while (g2.phase !== "finished" && t < 300) { g2.update(DT); t += DT; }
  ok(g2.phase === "finished" && g2.setPaused(true) === false && !g2.paused, "結算後 setPaused 無效");
}

// ② 完美起跑
{
  const runStart = (mode) => {   // "go"=GO 後 0.1 秒才踩;"countdown3"=倒數一開始就按住;"never"=不踩
    const g = new RacingGame({ headless: true });
    const events = [];
    g.onEvent = (t, d) => events.push({ t, d });
    g.startRace({ trackId: "meadow", laps: 1, aiCount: 0, difficulty: "normal", gridPos: "front" });
    g.input.throttle = mode === "countdown3" ? 1 : 0;
    while (g.phase === "countdown") g.update(DT);
    if (mode === "go") { steps(g, 0.1); g.input.throttle = 1; }
    steps(g, 1.5);
    return { g, events, speed: g.player.speed, turbo: g.player.turbo };
  };
  const late = runStart("go"), early = runStart("countdown3"), never = runStart("never");
  ok(late.events.some((e) => e.t === "perfectstart" && e.d.p === 0), "GO 後 0.1 秒踩油門 ⇒ perfectstart 事件(P1)");
  ok(late.g.player.startJudged === true, "判定只做一次");
  ok(late.events.some((e) => e.t === "boost"), "完美起跑真的觸發 boost(火焰會亮、音效會響)");
  ok(late.turbo > 0.99, `完美起跑的渦輪是免費的(turbo ${late.turbo.toFixed(2)})`);
  ok(!early.events.some((e) => e.t === "perfectstart"), "倒數一開始就按住 ⇒ 沒有完美起跑");
  ok(early.speed > 5 && early.turbo === 1, `太早按不罰:照樣跑(${early.speed.toFixed(1)} m/s)、渦輪沒被扣`);
  ok(late.speed > early.speed + 1.5, `完美起跑 1.5 秒後更快:${late.speed.toFixed(1)} vs ${early.speed.toFixed(1)} m/s`);
  ok(!never.events.some((e) => e.t === "perfectstart") && never.g.player.startJudged === true && never.speed === 0, "沒踩油門:window 過後判定關閉、車不動");
  {
    const g = new RacingGame({ headless: true }); const ev = []; g.onEvent = (t) => ev.push(t);
    g.startRace({ trackId: "meadow", laps: 1, aiCount: 0, difficulty: "kids", gridPos: "front" });
    while (g.phase === "countdown" && g.countdownT > 1.0) g.update(DT);
    g.input.throttle = 1;
    while (g.phase === "countdown") g.update(DT);
    steps(g, 0.2);
    ok(ev.includes("perfectstart"), `倒數到「1」才踩(按住約 1 秒 < ${PERFECT_START.hold})⇒ 也算完美起跑(對幼兒寬)`);
  }
  {
    const g = new RacingGame({ headless: true }); const ev = []; g.onEvent = (t) => ev.push(t);
    g.startRace({ trackId: "meadow", laps: 1, aiCount: 0, difficulty: "kids", gridPos: "front" });
    while (g.phase === "countdown" && g.countdownT > 2.0) g.update(DT);
    g.input.throttle = 1;
    while (g.phase === "countdown") g.update(DT);
    steps(g, 0.2);
    ok(!ev.includes("perfectstart"), "倒數到「2」就按住(約 2 秒)⇒ 不算");
  }
  {
    // AI 完美起跑:依技巧機率(職業約 48%、幼兒約 22%);種子每場輪換但同一個 RacingGame 序列固定 ⇒ 六場合計可重現
    const countAi = (difficulty) => {
      const g = new RacingGame({ headless: true }); g.autopilot = true;
      let got = 0, total = 0;
      for (let r = 0; r < 6; r++) {
        g.startRace({ trackId: "meadow", laps: 1, aiCount: 5, difficulty });
        while (g.phase === "countdown") g.update(DT);
        for (const c of g.cars) if (!c.isPlayer) { total++; if (c.startBoostT > 0) got++; }
        steps(g, 2);
        ok(g.cars.every((c) => Number.isFinite(c.speed) && Number.isFinite(c.turbo) && c.turbo <= 1), `${difficulty} 第 ${r + 1} 場:免費渦輪後數值有限、turbo ≤ 1`);
      }
      return { got, total };
    };
    const hard = countAi("hard"), kids = countAi("kids");
    ok(hard.total === 30 && hard.got >= 6 && hard.got <= 24, `職業 AI 六場 30 台有 ${hard.got} 台完美起跑(約一半,不是全有也不是全無)`);
    ok(kids.got <= 14 && kids.got < hard.got, `幼兒 AI 六場 30 台只有 ${kids.got} 台(少於職業)`);
    const g1 = new RacingGame({ headless: true }); g1.autopilot = true;
    g1.startRace({ trackId: "meadow", laps: 1, aiCount: 3, difficulty: "normal" });
    const lanes1 = g1.cars.filter((c) => !c.isPlayer).map((c) => g1.brains.get(c).lane);
    g1.startRace({ trackId: "meadow", laps: 1, aiCount: 3, difficulty: "normal" });
    const lanes2 = g1.cars.filter((c) => !c.isPlayer).map((c) => g1.brains.get(c).lane);
    ok(JSON.stringify(lanes1) !== JSON.stringify(lanes2), "再來一場:AI 種子輪換,車道偏好不一樣");
  }
  {
    const g = new RacingGame({ headless: true }); const ev = []; g.onEvent = (t, d) => ev.push({ t, d });
    g.startRace({ mode: "duel2p", trackId: "meadow", laps: 1, aiCount: 0, difficulty: "normal" });
    g.input.throttle = 1;
    while (g.phase === "countdown") g.update(DT);
    steps(g, 0.1); g.input2.throttle = 1; steps(g, 0.3);
    const ps = ev.filter((e) => e.t === "perfectstart").map((e) => e.d.p);
    ok(ps.length === 1 && ps[0] === 1, `雙人:P1 太早、只有 P2 完美起跑 ${JSON.stringify(ps)}`);
  }
}

// ③ 紀錄純函數
{
  const r0 = emptyRecords();
  const a = applyResult(r0, { trackId: "meadow", laps: 3, difficulty: "easy", time: 100, bestLap: 33, date: "2026-09-07" });
  ok(a.newTime && a.newLap && a.prevTime === 0 && a.prevLap === 0, "空紀錄 ⇒ 兩項都是新的、沒有舊值");
  ok(Object.keys(r0.time).length === 0 && Object.keys(r0.lap).length === 0, "applyResult 不改原物件(純函數)");
  ok(a.records.time["meadow|3|easy"].date === "2026-09-07", "紀錄帶日期");
  const b = applyResult(a.records, { trackId: "meadow", laps: 3, difficulty: "easy", time: 120, bestLap: 40 });
  ok(!b.newTime && !b.newLap && b.prevTime === 100 && b.prevLap === 33, "更慢 ⇒ 不覆寫、回報舊紀錄");
  const c = applyResult(b.records, { trackId: "meadow", laps: 3, difficulty: "easy", time: 90, bestLap: 35 });
  ok(c.newTime && !c.newLap && c.prevTime === 100 && c.prevLap === 33, "總時間破、單圈沒破:各自獨立");
  const d = applyResult(c.records, { trackId: "meadow", laps: 1, difficulty: "easy", time: 31, bestLap: 31 });
  ok(d.newTime && d.newLap && d.prevTime === 0 && d.prevLap === 33, "換圈數:總時間另一把 key、單圈同一把(同賽道同難度)");
  const e = applyResult(d.records, { trackId: "meadow-rev", laps: 1, difficulty: "easy", time: 31, bestLap: 31 });
  ok(e.newTime && e.prevLap === 0, "逆走是另一條賽道,紀錄分開");
  const f = applyResult(e.records, { trackId: "meadow", laps: 1, difficulty: "hard", time: 20, bestLap: 20 });
  ok(f.prevTime === 0 && f.prevLap === 0, "不同難度分開");
  const g = getRecord(f.records, "meadow", 3, "easy");
  ok(g.time === 90 && g.lap === 31, `getRecord 讀回 time ${g.time} / lap ${g.lap}`);
  ok(getRecord(f.records, "snow", 1, "kids").time === 0 && getRecord(null, "snow", 1, "kids").lap === 0, "沒有紀錄回 0(null 也不炸)");
  ok(lapKey("meadow", "easy") === "meadow|easy" && timeKey("meadow", 3, "easy") === "meadow|3|easy", "key 格式");
  const bad = normalizeRecords({ time: "nope", lap: { "x|y": { t: "abc" }, "a|b": 12 }, extra: 1 });
  ok(bad && typeof bad.time === "object" && Object.keys(bad.time).length === 0 && bad.lap["a|b"].t === 12 && !bad.lap["x|y"], "亂值正規化:壞的丟、舊格式純數字保留");
  ok(applyResult(f.records, { trackId: "meadow", laps: 3, difficulty: "easy", time: NaN, bestLap: 0 }).newTime === false, "NaN/0 不記");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(todayStr()), "todayStr 本地日期格式");
  ok(todayStr(new Date(2026, 0, 5, 23, 30)) === "2026-01-05", "todayStr 補零、用本地不用 toISOString(晚上不會變隔天)");
}

// ④ 方向變體能開賽
{
  const g = new RacingGame({ headless: true }); g.autopilot = true;
  g.startRace({ trackId: "snow-mirrev", laps: 1, aiCount: 1, difficulty: "normal" });
  ok(g.track.id === "snow-mirrev" && g.track.base === "snow" && g.track.variant === "mirrev" && /鏡像逆走/.test(g.track.label), `變體開賽「${g.track.label}」`);
  let t = 0; while (g.phase !== "finished" && t < 400) { g.update(DT); t += DT; }
  ok(g.phase === "finished", `鏡像逆走自動駕駛 ${t.toFixed(0)}s 完賽`);
  ok(g.results.trackId === "snow-mirrev" && g.results.difficultyId === "normal" && g.results.trackLength > 1000, "結算帶 trackId/difficultyId/trackLength(給紀錄與排行房)");
  ok(trackIdOf("meadow", "") === "meadow" && trackIdOf("meadow", "rev") === "meadow-rev", "trackIdOf");
  ok(Object.keys(VARIANT_LABELS).length === 4, "四種變體都有中文名");
  for (const id of Object.keys(TRACKS)) ok(typeof TRACKS[id].label === "string" && TRACKS[id].label.length > 0 && !!TRACKS[id].emoji, `賽道 ${id} 有名字與 emoji`);
  ok(TRACKS.meadow.label === "草原環道" && TRACKS["meadow-rev"].label === "草原環道・逆走", "正走不加後綴、逆走加");
}

// ⑤ 播報新句
{
  ok(phraseFor("perfectstart") === "完美起跑!" && PHRASES.includes("完美起跑!"), "完美起跑有唸稿");
  ok(phraseFor("newrecord") === "新紀錄!太厲害了!" && PHRASES.includes("新紀錄!太厲害了!"), "新紀錄有唸稿");
  ok(phraseFor("pause") === null && phraseFor("resume") === null, "暫停/繼續不唸");
}

console.log(`v3.test: ${n} 項通過`);
