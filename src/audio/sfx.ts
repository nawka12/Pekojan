// Tiny WebAudio synth — original placeholder sounds (rule doc §33).
// No external assets; every sound is synthesized so the bundle stays clean
// and disableable.

let ctx: AudioContext | null = null;
let ctxUnavailable = false;

function ac(): AudioContext | null {
  if (ctxUnavailable || typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor =
        window.AudioContext ?? (window as never as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (typeof Ctor !== "function") {
        ctxUnavailable = true;
        return null;
      }
      ctx = new Ctor();
    } catch {
      ctxUnavailable = true;
      return null;
    }
  }
  return ctx;
}

export type SoundName =
  | "draw"
  | "discard"
  | "button"
  | "pekojan"
  | "large"
  | "chain"
  | "score"
  | "victory"
  | "defeat";

interface ToneSpec {
  freq: number;
  dur: number;
  type: OscillatorType;
  gain?: number;
  sweepTo?: number;
  delay?: number;
}

const RECIPES: Record<SoundName, ToneSpec[]> = {
  draw: [{ freq: 320, dur: 0.07, type: "triangle", gain: 0.14 }],
  discard: [{ freq: 220, dur: 0.08, type: "sine", gain: 0.14, sweepTo: 160 }],
  button: [{ freq: 520, dur: 0.05, type: "square", gain: 0.05 }],
  pekojan: [
    { freq: 440, dur: 0.12, type: "sawtooth", gain: 0.16 },
    { freq: 660, dur: 0.14, type: "sawtooth", gain: 0.16, delay: 0.1 },
    { freq: 880, dur: 0.22, type: "triangle", gain: 0.2, delay: 0.2 },
  ],
  large: [
    { freq: 330, dur: 0.16, type: "sawtooth", gain: 0.2 },
    { freq: 495, dur: 0.16, type: "sawtooth", gain: 0.2, delay: 0.12 },
    { freq: 660, dur: 0.2, type: "sawtooth", gain: 0.22, delay: 0.24 },
    { freq: 990, dur: 0.34, type: "triangle", gain: 0.26, delay: 0.36 },
  ],
  chain: [
    { freq: 587, dur: 0.09, type: "square", gain: 0.12 },
    { freq: 784, dur: 0.13, type: "square", gain: 0.12, delay: 0.08 },
  ],
  score: [{ freq: 700, dur: 0.1, type: "sine", gain: 0.12, sweepTo: 900 }],
  victory: [
    { freq: 523, dur: 0.15, type: "triangle", gain: 0.2 },
    { freq: 659, dur: 0.15, type: "triangle", gain: 0.2, delay: 0.14 },
    { freq: 784, dur: 0.18, type: "triangle", gain: 0.22, delay: 0.28 },
    { freq: 1047, dur: 0.4, type: "triangle", gain: 0.24, delay: 0.42 },
  ],
  defeat: [{ freq: 300, dur: 0.5, type: "sine", gain: 0.18, sweepTo: 140 }],
};

export function play(name: SoundName, volume = 0.6) {
  if (volume <= 0) return;
  const audio = ac();
  if (!audio || audio.state === "suspended") {
    void audio?.resume();
  }
  if (!audio) return;
  const t0 = audio.currentTime;
  for (const spec of RECIPES[name]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = spec.type;
    const start = t0 + (spec.delay ?? 0);
    osc.frequency.setValueAtTime(spec.freq, start);
    if (spec.sweepTo) osc.frequency.exponentialRampToValueAtTime(spec.sweepTo, start + spec.dur);
    gain.gain.setValueAtTime(spec.gain ?? 0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + spec.dur + 0.02);
  }
}
