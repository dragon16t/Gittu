import { useSyncExternalStore } from "react";

const HI = {
  "Balance": "बैलेंस", "Deposit": "जमा करें", "Refer & Earn": "रेफर करें और कमाएं", "LIVE WINS": "लाइव जीत",
  "No wins yet — be the first": "अभी कोई जीत नहीं — पहले बनें", "PLAY": "खेलो", "WATCH": "देखो", "WIN BIG": "बड़ा जीतो",
  "REAL GAMES. REAL PLAYERS. REAL WINS.": "असली गेम. असली खिलाड़ी. असली जीत.", "PLAY NOW": "अभी खेलें",
  "FEEL THE PULSE": "पल्स महसूस करें", "PREDICT. WIN. REPEAT.": "अनुमान. जीत. दोहराएं.",
  "Home": "होम", "Pulse Arena": "पल्स एरीना", "Oddy Nacho": "ऑडी नाचो", "History": "इतिहास",
  "Place your bets": "अपना दांव लगाएं", "Total Win": "कुल जीत", "Bet": "दांव", "PLACE BET": "दांव लगाएं",
  "COLLECT": "कलेक्ट करें", "COLLECTED": "कलेक्ट हुआ", "ROUND LOST": "राउंड हारे", "NEXT ROUND": "अगला राउंड",
  "BET PLACED": "दांव लगा", "ROUND ENDS": "राउंड खत्म", "Recent Rounds": "हाल के राउंड", "View All": "सभी देखें",
  "LOW BALANCE": "कम बैलेंस", "CHECK AMOUNT": "राशि जांचें", "BETTING CLOSED": "दांव बंद", "Round": "राउंड",
  "Login": "लॉगिन", "Sign Up": "साइन अप", "Username": "यूज़रनेम", "Password": "पासवर्ड", "Forgot Password?": "पासवर्ड भूल गए?",
  "Signing in…": "लॉगिन हो रहा है…", "Play responsibly. 18+ only.": "ज़िम्मेदारी से खेलें. केवल 18+.",
  "Mobile number": "मोबाइल नंबर", "Email": "ईमेल", "SEND OTP": "OTP भेजें", "Email code (6 digits)": "ईमेल कोड (6 अंक)",
  "Date of birth": "जन्म तिथि", "Confirm password": "पासवर्ड की पुष्टि करें", "Referral code (optional)": "रेफ़रल कोड (वैकल्पिक)",
  "Min 8 characters with letters and numbers.": "कम से कम 8 अक्षर, अक्षर और अंक दोनों.", "Have an account?": "पहले से खाता है?",
  "Create account": "खाता बनाएं", "Code sent. Check your inbox (and spam).": "कोड भेजा गया. इनबॉक्स (और स्पैम) देखें.",
  "Oddy Nacho rounds": "ऑडी नाचो राउंड", "Mobile Number or Username": "मोबाइल नंबर या यूज़रनेम", "Enter Password": "पासवर्ड डालें",
  "Remember me": "मुझे याद रखें", "won": "ने जीते", "at": "पर", "Fast": "तेज़", "Secure": "सुरक्षित", "Transparent": "पारदर्शी", "Rounds": "राउंड",
  "Payments": "भुगतान", "Results": "परिणाम", "Winning Payout": "जीत भुगतान", "Secure & Safe": "सुरक्षित", "Support": "सहायता",
  "Fair Play": "निष्पक्ष खेल", "Responsible Gaming": "ज़िम्मेदार गेमिंग", "Pulse rounds": "पल्स राउंड",
};

const KEY = "lang";
let lang = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) || "en";
const subs = new Set();

export const setLang = (l) => {
  lang = l;
  localStorage.setItem(KEY, l);
  document.documentElement.lang = l;
  subs.forEach((f) => f());
};

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

export const useLang = () => useSyncExternalStore(subscribe, () => lang);

export const useT = () => {
  const l = useLang();
  return (s) => (l === "hi" ? HI[s] || s : s);
};

export const LangSwitch = ({ className = "" }) => {
  const l = useLang();
  return (
    <div className={`inline-flex h-8 items-center rounded-full border border-white/15 bg-black/70 p-0.5 text-[11px] font-bold ${className}`} data-testid="lang-switch">
      {[["en", "EN"], ["hi", "हिं"]].map(([k, label]) => (
        <button key={k} type="button" onClick={() => setLang(k)} data-testid={`lang-${k}`}
          className={`h-7 min-w-[34px] rounded-full px-2 transition-colors ${l === k ? "silver-btn text-black" : "text-neutral-300"}`}>{label}</button>
      ))}
    </div>
  );
};
