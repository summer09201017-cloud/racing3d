// audio.js —— 合成音效(Web Audio,零音檔):引擎聲(轉速跟車速)、渦輪、撞牆、輪胎滑、倒數、圈數、完賽。
// 人聲鐵律:播報只走字幕(voice mp3 尚未烤);沒 Web Audio 或被靜音就靜默 fallback。
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MASTER = 0.6;

export class AudioManager {
  constructor() {
    this.ctx = null; this.master = null; this.enabled = true;
    this.engine = null;   // { osc1, osc2, gain, filter, lfo }
    this.skid = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? MASTER : 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? MASTER : 0;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  unlock() {
    const c = this.ensure();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }

  suspend() { try { this.ctx && this.ctx.suspend(); } catch { /* ignore */ } }
  resume() { try { this.ctx && this.ctx.resume(); } catch { /* ignore */ } }

  tone({ f = 440, fEnd = null, dur = 0.12, type = "sine", gain = 0.12, when = 0 }) {
    const c = this.ensure();
    if (!c || !this.enabled) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(Math.max(30, fEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(clamp(gain, 0.0001, 0.5), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  noise({ dur = 0.2, gain = 0.2, f = 800, q = 1, when = 0 }) {
    const c = this.ensure();
    if (!c || !this.enabled) return;
    const t0 = c.currentTime + when;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(clamp(gain, 0, 0.6), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0);
  }

  /* ── 引擎聲:鋸齒+方波低八度,低通隨轉速開,音量隨油門 ── */
  startEngine() {
    const c = this.ensure();
    if (!c || this.engine) return;
    const osc1 = c.createOscillator(), osc2 = c.createOscillator();
    osc1.type = "sawtooth"; osc2.type = "square";
    const filter = c.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 400; filter.Q.value = 2;
    const gain = c.createGain(); gain.gain.value = 0.0001;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    osc1.connect(filter); osc2.connect(g2); g2.connect(filter);
    filter.connect(gain); gain.connect(this.master);
    osc1.frequency.value = 70; osc2.frequency.value = 35;
    osc1.start(); osc2.start();
    this.engine = { osc1, osc2, gain, filter };
    // 輪胎滑:持續噪音源,音量平常 0
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
    const sg = c.createGain(); sg.gain.value = 0.0001;
    src.connect(bp); bp.connect(sg); sg.connect(this.master);
    src.start();
    this.skid = { src, gain: sg };
  }

  /** 每幀:rpm 0..1、油門 0..1、渦輪、滑移量 0..1、是否在比賽(選單/結算引擎怠速)。 */
  setEngine(rpm, throttle, boosting, slip, active) {
    if (!this.engine || !this.ctx) return;
    const c = this.ctx, e = this.engine;
    const now = c.currentTime;
    const base = 55 + rpm * 190 + (boosting ? 40 : 0);
    e.osc1.frequency.setTargetAtTime(base, now, 0.05);
    e.osc2.frequency.setTargetAtTime(base / 2, now, 0.05);
    e.filter.frequency.setTargetAtTime(320 + rpm * 1900 + throttle * 500, now, 0.06);
    const vol = active ? 0.05 + throttle * 0.08 + rpm * 0.05 : 0.03;
    e.gain.gain.setTargetAtTime(this.enabled ? vol : 0.0001, now, 0.08);
    if (this.skid) this.skid.gain.gain.setTargetAtTime(this.enabled && active ? clamp(slip, 0, 1) * 0.12 : 0.0001, now, 0.06);
  }

  /* ── 一次性 ── */
  countdown(n) { this.tone({ f: n === 1 ? 660 : 520, dur: 0.18, type: "square", gain: 0.12 }); }
  go() { this.tone({ f: 880, dur: 0.5, type: "square", gain: 0.16 }); this.tone({ f: 1320, dur: 0.5, type: "triangle", gain: 0.1, when: 0.02 }); }
  bump(speed = 10) {
    const g = clamp(0.12 + speed / 60, 0.12, 0.4);
    this.noise({ dur: 0.22, gain: g, f: 220, q: 0.7 });
    this.tone({ f: 120, fEnd: 50, dur: 0.25, type: "triangle", gain: g * 0.7 });
  }
  offtrack() { this.noise({ dur: 0.35, gain: 0.12, f: 500, q: 0.5 }); }
  boost() { this.tone({ f: 200, fEnd: 900, dur: 0.6, type: "sawtooth", gain: 0.08 }); this.noise({ dur: 0.5, gain: 0.1, f: 2400, q: 0.6 }); }
  lap(final) {
    this.tone({ f: 784, dur: 0.15, type: "triangle", gain: 0.14 });
    this.tone({ f: 1046, dur: 0.22, type: "triangle", gain: 0.14, when: 0.15 });
    if (final) this.tone({ f: 1318, dur: 0.3, type: "triangle", gain: 0.14, when: 0.36 });
  }
  wrongWay() { this.tone({ f: 330, dur: 0.15, type: "square", gain: 0.08 }); this.tone({ f: 262, dur: 0.2, type: "square", gain: 0.08, when: 0.17 }); }
  rescue() { this.tone({ f: 520, fEnd: 780, dur: 0.3, type: "sine", gain: 0.1 }); }
  finish(rank) {
    const seq = rank === 1 ? [523, 659, 784, 1046, 1318] : rank <= 3 ? [523, 659, 784, 1046] : [523, 659, 784];
    seq.forEach((f, i) => this.tone({ f, dur: 0.28, type: "triangle", gain: 0.16, when: i * 0.16 }));
    if (rank === 1) this.tone({ f: 1568, dur: 0.6, type: "triangle", gain: 0.14, when: 0.9 });
  }
  uiTap() { this.tone({ f: 540, fEnd: 760, dur: 0.07, type: "triangle", gain: 0.06 }); }
}
