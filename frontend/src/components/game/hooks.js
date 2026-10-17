import { useEffect, useRef, useState } from "react";
import { unlockAudio } from "@/lib/sfx";

const UNLOCK_EVENTS = ["click", "touchend", "keydown"];

export const useMusic = () => {
  const audio = useRef(null);
  const [on, setOn] = useState(() => localStorage.getItem("oe_music") !== "off");
  useEffect(() => {
    const a = new Audio("/game-music.mp3");
    a.loop = true;
    a.volume = 0.45;
    audio.current = a;
    const start = () => {
      if (localStorage.getItem("oe_music") !== "off" && a.paused) a.play().catch(() => {});
    };
    const unlock = () => { unlockAudio(); start(); };
    const vis = () => (document.hidden ? a.pause() : start());
    start();
    UNLOCK_EVENTS.forEach((e) => window.addEventListener(e, unlock, true));
    document.addEventListener("visibilitychange", vis);
    return () => {
      a.pause();
      a.src = "";
      UNLOCK_EVENTS.forEach((e) => window.removeEventListener(e, unlock, true));
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem("oe_music", next ? "on" : "off");
    if (next) { unlockAudio(); audio.current?.play().catch(() => {}); }
    else audio.current?.pause();
  };
  return [on, toggle];
};

export const useRevealAnimation = () => {
  const [label, setLabel] = useState(null);
  const [final, setFinal] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const timers = useRef([]);
  const show = (result) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSpinning(false);
    setLabel(result);
    setFinal(true);
  };
  const run = (result, onDone) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setFinal(false);
    setSpinning(true);
    let t = 0;
    let delay = 28;
    let cur = Math.random() < 0.5 ? "ODD" : "EVEN";
    while (t + delay < 2500) {
      t += delay;
      const v = cur;
      timers.current.push(setTimeout(() => setLabel(v), t));
      cur = cur === "ODD" ? "EVEN" : "ODD";
      delay *= t < 1700 ? 1.02 : 1.22;
    }
    timers.current.push(setTimeout(() => { setLabel(result); setFinal(true); setSpinning(false); onDone && onDone(); }, Math.max(t + 260, 2400)));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return { label, final, spinning, run, show, setLabel, setFinal };
};
