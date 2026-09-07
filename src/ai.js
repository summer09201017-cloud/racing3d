// ai.js —— 對手 AI(npc-ai-kit「對手 AI 三式」:追點+彎前煞車+溫柔橡皮筋)。純函數。
// 與玩家跑同一套 stepCar 物理、同一套渦輪計費(race-stage-kit ⑥:AI 加速也要錢,不然是永動機)。
import { pointAtOffset, maxCurvatureAhead, wrapDist } from "./track.js";
import { clamp, wrapAngle } from "./vehicle.js";

/** 每台 AI 一份腦子狀態。seed 決定車道偏好與個性(可重現)。 */
export function makeAiBrain(seed = Math.random(), cfg) {
  const rnd = mulberry32(Math.floor(seed * 1e9));
  return {
    rnd,
    lane: (rnd() - 0.5) * 0.8,        // 偏好車道(占半寬比例 −0.4..0.4)
    laneNow: 0,
    laneTimer: 2 + rnd() * 5,
    skillMul: 0.86 + cfg.aiSkill * 0.12 + rnd() * 0.09,  // 個人極速倍率(技巧高=跑得滿;亂數項拉開車距,不然黏成一團)
    boostHold: 0,
    boostCd: 3 + rnd() * 4,
    avoid: 0,
  };
}

/** 給 AI 這幀的輸入。cars 是全部車(閃避用),player 給橡皮筋。 */
export function aiInput(car, brain, track, cfg, dt, cars = [], player = null) {
  const halfW = track.halfW;
  // 車道漫遊:每幾秒換一次偏好,慢慢滑過去(有人味,不像軌道車)
  brain.laneTimer -= dt;
  if (brain.laneTimer <= 0) { brain.lane = (brain.rnd() - 0.5) * 0.8; brain.laneTimer = 4 + brain.rnd() * 6; }
  // 閃避:前方 3~10m 內、橫向差 <2.6m 的車 ⇒ 往反方向偏一個車寬;太近就鬆油
  let closeAhead = false;
  brain.avoid *= Math.exp(-dt * 1.5);
  for (const o of cars) {
    if (o === car || o.finished) continue;
    let gap = o.trackDist - car.trackDist;
    if (gap > track.length / 2) gap -= track.length; else if (gap < -track.length / 2) gap += track.length;
    const dl = o.lateral - car.lateral;
    if (gap > 1.5 && gap < 10 && Math.abs(dl) < 2.6) {
      brain.avoid = clamp(brain.avoid - Math.sign(dl || 1) * 0.5, -1, 1);
      if (gap < 4.5 && o.speed < car.speed + 0.5) closeAhead = true;
    } else if (Math.abs(gap) <= 5 && Math.abs(dl) < 2.9) {
      brain.avoid = clamp(brain.avoid - Math.sign(dl || 1) * 0.3, -1, 1);   // 肩並肩:也往外讓一點
    }
  }
  const laneTarget = clamp(brain.lane + brain.avoid * 0.45, -0.55, 0.55) * halfW;
  brain.laneNow += (laneTarget - brain.laneNow) * Math.min(1, dt * 1.2);

  // 追點:前方 lookahead 公尺的車道點
  const look = clamp(6 + Math.abs(car.speed) * 0.5, 8, 26);
  const tgt = pointAtOffset(track, car.trackDist + look, brain.laneNow);
  const desired = Math.atan2(tgt.x - car.x, tgt.z - car.z);
  const dH = wrapAngle(desired - car.heading);
  // 右轉(dH<0)⇒ steer>0(heading 遞減)。技巧低=轉向鬆(0.55)、高=緊(0.38)
  const gain = 0.55 - cfg.aiSkill * 0.17;
  let steer = clamp(-dH / gain, -1, 1);
  // 出界/貼牆時全力回中線
  if (car.offTrack) steer = clamp(steer - Math.sign(car.lateral) * 0.5, -1, 1);

  // 速度目標:彎前煞車 v = sqrt(latAcc / k),看前方 12 + v*1.1 m
  const kmax = maxCurvatureAhead(track, car.trackDist, 12 + Math.abs(car.speed) * 1.1);
  const latAcc = cfg.aiLatAcc * ((car.params && car.params.gripMul) || 1);   // v4:馬抓地好彎速高、摩托車反之
  const vCorner = kmax > 1e-4 ? Math.sqrt(latAcc / kmax) : Infinity;
  let target = Math.min(cfg.aiMax * brain.skillMul, vCorner);
  // 溫柔橡皮筋:領先玩家 >70m 稍微收、落後 >70m 稍微放(永不無限快)
  if (player && player !== car && !player.finished) {
    const gap = car.progress - player.progress;
    if (gap > 70) target *= 0.9;
    else if (gap < -70) target *= 1.05;
  }
  if (car.wrongWay) target = 4;
  if (closeAhead) target = Math.min(target, Math.abs(car.speed) - 1);

  let throttle = 0, brake = 0;
  if (car.speed < target - 0.4) throttle = 1;
  else if (car.speed < target) throttle = 0.5;
  if (car.speed > target + 1.5) brake = clamp((car.speed - target) / 6, 0.25, 1);
  if (car.speed < 0.5 && !car.wrongWay) throttle = 1;       // 起跑/救援後一定會動

  // 渦輪:直線(kmax 小)、沒被擋、油門全開、渦輪 >0.55 才用;按住 1.2~2s;冷卻依難度
  brain.boostHold = Math.max(0, brain.boostHold - dt);
  brain.boostCd = Math.max(0, brain.boostCd - dt);
  let boost = brain.boostHold > 0;
  if (!boost && brain.boostCd <= 0 && cfg.aiBoost > 0 && car.turbo > 0.55 && !car.tired && kmax < 0.012 && throttle === 1 && !closeAhead) {
    if (brain.rnd() < cfg.aiBoost * dt * 2) { brain.boostHold = 1.2 + brain.rnd() * 0.8; brain.boostCd = 4 + brain.rnd() * 5; boost = true; }
  }
  if (brake > 0) boost = false;
  return { throttle, brake, steer, boost, handbrake: false };
}

/** 玩家自動駕駛(測試用「完美線」與展示)。 */
export function autopilotInput(car, brain, track, cfg, dt, cars) {
  return aiInput(car, brain, track, cfg, dt, cars, null);
}

export { wrapDist };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
