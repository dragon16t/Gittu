let ctx = null;
const ac = () => {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};
const muted = () => localStorage.getItem("oe_music") === "off";

const tone = (freq, start, dur, type = "sine", vol = 0.18) => {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
};

export const playBetSound = () => {
  if (muted()) return;
  try {
    tone(880, 0, 0.08, "triangle", 0.2);
    tone(1320, 0.06, 0.14, "sine", 0.16);
  } catch {}
};

export const playWinSound = () => {
  if (muted()) return;
  try {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.09, 0.32, "triangle", 0.17));
    tone(2093, 0.5, 0.5, "sine", 0.08);
  } catch {}
};
