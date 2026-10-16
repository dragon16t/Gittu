import { useEffect, useRef, useState } from "react";

export const useMusic = () => {
  const audio = useRef(null);
  const [on, setOn] = useState(() => localStorage.getItem("oe_music") !== "off");
  useEffect(() => {
    const a = new Audio("/game-music.mp3");
    a.loop = true;
    a.volume = 0.45;
    audio.current = a;
    const start = () => localStorage.getItem("oe_music") !== "off" && a.play().catch(() => {});
    start();
    const unlock = () => start();
    const vis = () => (document.hidden ? a.pause() : start());
    window.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("visibilitychange", vis);
    return () => {
      a.pause();
      a.src = "";
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem("oe_music", next ? "on" : "off");
    if (next) audio.current?.play().catch(() => {});
    else audio.current?.pause();
  };
  return [on, toggle];
};

export const useRevealAnimation = () => {
  const [label, setLabel] = useState(null);
  const [final, setFinal] = useState(false);
  const timers = useRef([]);
  const run = (result, onDone) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setFinal(false);
    let t = 0;
    let delay = 55;
    let cur = Math.random() < 0.5 ? "ODD" : "EVEN";
    while (t + delay < 2500) {
      t += delay;
      const v = cur;
      timers.current.push(setTimeout(() => setLabel(v), t));
      cur = cur === "ODD" ? "EVEN" : "ODD";
      delay *= 1.16;
    }
    timers.current.push(setTimeout(() => { setLabel(result); setFinal(true); onDone && onDone(); }, Math.max(t + 260, 2400)));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return { label, final, run, setLabel, setFinal };
};
