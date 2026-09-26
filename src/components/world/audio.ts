// Synthesized sounds (Web Audio, no files): a calm original marimba loop in a Mii-plaza mood, pops and a jingle.
// The browser only allows audio after a user gesture, so everything starts on the first click.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let muted = false;

// C major pentatonic, I - vi - IV - V
const CHORDS = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
const PATTERN = [0, 2, 1, 3, 2, 1, 3, 2];
const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function note(midi: number, when: number, dur = 0.5, vol = 0.12, type: OscillatorType = "triangle") {
  if (!ctx || !master) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq(midi);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + dur + 0.05);
}

export function startAudio() {
  if (ctx) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  let step = 0;
  loop = setInterval(() => {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05, chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    note(chord[PATTERN[step % 8]] + 12, t, 0.45, 0.07);
    if (step % 8 === 0) note(chord[0] - 12, t, 1.6, 0.06, "sine");
    step++;
  }, 280);
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
}

export function pop(pitch = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  note(84 + pitch, t, 0.12, 0.12, "sine");
  note(91 + pitch, t + 0.04, 0.1, 0.08, "sine");
}

export function jingle() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [72, 76, 79, 84].forEach((m, i) => note(m, t + i * 0.08, 0.35, 0.1));
}

export function stopAudio() {
  if (loop) clearInterval(loop);
  loop = null;
  ctx?.close();
  ctx = null;
  master = null;
}
