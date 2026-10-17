import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";

const KEY = "oe_install_dismissed";
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const recentlyDismissed = () => Date.now() - Number(localStorage.getItem(KEY) || 0) < 3 * 86400000;

export const InstallBanner = () => {
  const [evt, setEvt] = useState(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (standalone() || recentlyDismissed()) return;
    const onPrompt = (e) => { e.preventDefault(); setEvt(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const t = isIOS() ? setTimeout(() => setShow(true), 4000) : null;
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); t && clearTimeout(t); };
  }, []);
  if (!show) return null;
  const close = () => { localStorage.setItem(KEY, String(Date.now())); setShow(false); };
  const install = async () => { evt.prompt(); await evt.userChoice.catch(() => {}); close(); };
  return (
    <div className="fixed z-[60] left-1/2 -translate-x-1/2 w-[min(460px,calc(100%-20px))] bottom-[calc(150px+env(safe-area-inset-bottom))] rise" data-testid="install-banner">
      <div className="panel !rounded-2xl px-3.5 py-3 flex items-center gap-3 border-white/25 shadow-2xl">
        <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-white">Add to Home Screen</div>
          <div className="text-[11px] text-neutral-400 leading-snug">
            {evt ? "Install the app for full-screen, faster play." : <>Tap <Share size={11} className="inline -mt-0.5" /> Share, then “Add to Home Screen”.</>}
          </div>
        </div>
        {evt && <button onClick={install} className="silver-btn rounded-full h-9 px-4 text-xs font-extrabold flex items-center gap-1.5" data-testid="install-app-button"><Download size={13} />INSTALL</button>}
        <button onClick={close} className="h-7 w-7 rounded-full ghost-chip flex items-center justify-center text-neutral-400" data-testid="install-dismiss-button" aria-label="Dismiss"><X size={13} /></button>
      </div>
    </div>
  );
};
