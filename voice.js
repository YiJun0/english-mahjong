// ══════════════════════════════════════════
// voice.js — 語音（主播喊「碰！」「自摸！」、聊天唸出來，帶點嘲諷感）
//
// 1. 有錄音檔就播錄音檔（最生動）：放在 voices/ 資料夾，檔名見 voices/說明.txt
// 2. 沒有錄音檔才用瀏覽器內建語音（TTS）：
//    - 自動挑最自然的中文聲音（Edge 的「Natural」語音最像真人）
//    - 每種動作有好幾種說法，隨機挑，不會每次都一樣
//    - 嘲諷句加上語氣詞（欸～、蛤？、嘿嘿）、拉長音、笑聲，分段改變音高
//    - 每句配一個搞笑音效（滑哨、悲傷長號、收銀機、時鐘、鼓聲）
// ══════════════════════════════════════════

// 動作語音：好幾種說法隨機挑
const VOICE_LINES = {
    chi:   { style: "shout", say: ["吃！"] },
    pung:  { style: "shout", say: ["碰！"] },
    kong:  { style: "shout", say: ["槓！"] },
    ckong: { style: "shout", say: ["槓！"] },
    akong: { style: "shout", say: ["槓！"] },
    tsumo: { style: "big",   say: ["自摸！"] },
    ron:   { style: "big",   say: ["胡！"] },
};

// 快捷語：唸畫面上的那句，語氣照句子調（問句上揚、「唉…」拉長、嗆聲句加重）
const TAUNT_SPEECH = [
    { say: "你是在等過年嗎？",                 rate: 1.05, pitch: 1.3 },
    { say: "你可以，打得再爛一點！",            rate: 1.0,  pitch: 1.2 },
    { say: "唉～，一手爛牌。",                  rate: 0.85, pitch: 0.95 },
    { say: "不怕神一樣的對手，就怕豬一樣的隊友！", rate: 1.1,  pitch: 1.15 },
    { say: "省省吧，你們是贏不了我的！",         rate: 1.0,  pitch: 1.25 },
];

// 語氣設定：rate 語速、pitch 音高（1 = 正常）
const VOICE_STYLE = {
    shout: { rate: 1.15, pitch: 1.2 },
    big:   { rate: 1.08, pitch: 1.45 },
    taunt: { rate: 1.1,  pitch: 1.25 },
};

const voiceFiles = {};          // key → Audio（有錄音檔才會有）
let bestVoice = null;

function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 幫中文語音打分數，挑最像真人的
function scoreVoice(v) {
    const name = (v.name || "").toLowerCase();
    const lang = (v.lang || "").toLowerCase().replace("_", "-");
    let s = 0;
    if (lang === "zh-tw") s += 50;
    else if (lang.startsWith("zh-hk")) s += 25;
    else if (lang.startsWith("zh") || lang.startsWith("cmn")) s += 20;
    else return -1;
    if (name.includes("natural")) s += 40;          // Edge 神經網路語音
    if (name.includes("online")) s += 15;
    if (name.includes("google")) s += 20;
    if (/hsiaochen|hsiaoyu|yunjhe|xiaoxiao|xiaoyi|yunxi/.test(name)) s += 10;
    if (v.localService === false) s += 5;
    return s;
}

function pickVoice() {
    try {
        const list = speechSynthesis.getVoices();
        let best = null, bestScore = -1;
        list.forEach(v => { const s = scoreVoice(v); if (s > bestScore) { best = v; bestScore = s; } });
        bestVoice = best;
    } catch (e) {}
}

// 讀取錄音檔（有就用，沒有就算了）
function voiceKeys() {
    return ["chi", "pung", "kong", "tsumo", "ron", ...TAUNT_SPEECH.map((_, i) => "taunt" + (i + 1))];
}
function preloadVoiceFiles() {
    if (location.protocol === "file:") return;
    voiceKeys().forEach(key => {
        fetch(`voices/${key}.mp3`, { method: "HEAD" })
            .then(r => { if (r.ok) { const a = new Audio(`voices/${key}.mp3`); a.preload = "auto"; voiceFiles[key] = a; } })
            .catch(() => {});
    });
}

if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
}
window.addEventListener("load", preloadVoiceFiles);

// 依標點切段，每段依語氣調整：
//   「欸～」「拜託～」這種開頭拉長、音調飄高；問句尾音上揚；笑聲又快又高
function speakSegments(text, base) {
    const parts = text.split(/(?<=[，,？?！!～~。])/).map(s => s.trim()).filter(Boolean);
    parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = "zh-TW";
        if (bestVoice) u.voice = bestVoice;
        let rate = base.rate, pitch = base.pitch;
        const laugh = /^(哈|嘿|呵)+[！!～~]?$/.test(part);
        const drawl = /^(欸|蛤|拜託|唉唷|唉|不好意思喔)[～~？?，,]?$/.test(part) || (i === 0 && /[～~]$/.test(part) && part.length <= 4);
        if (laugh)      { rate *= 1.35; pitch *= 1.3; }
        else if (drawl) { rate *= 0.75; pitch *= 1.25; }
        else if (/[？?]$/.test(part)) { pitch *= 1.18; }
        else if (/[～~]$/.test(part)) { rate *= 0.9; pitch *= 1.12; }
        else if (/[！!]$/.test(part)) { rate *= 1.08; pitch *= 1.05; }
        u.rate = Math.min(2, rate * (0.97 + Math.random() * 0.06));
        u.pitch = Math.min(2, pitch);
        u.volume = Math.min(1, masterVolume);
        speechSynthesis.speak(u);
    });
}

function playVoiceFile(key) {
    const file = voiceFiles[key];
    if (!file) return false;
    try {
        const a = file.cloneNode();
        a.volume = Math.min(1, masterVolume);
        a.play().catch(() => {});
        return true;
    } catch (e) { return false; }
}

// key：VOICE_LINES 的 key 或 taunt1～5
function fxVoice(key) {
    if (masterVolume <= 0) return;
    const tm = /^taunt(\d)$/.exec(key);
    const taunt = tm ? TAUNT_SPEECH[+tm[1] - 1] : null;
    if (playVoiceFile(key)) return;
    if ((key === "ckong" || key === "akong") && playVoiceFile("kong")) return;   // 暗槓、加槓共用「槓」的錄音
    try {
        if (!window.speechSynthesis) return;
        speechSynthesis.cancel();
        if (taunt) {
            speakSegments(taunt.say, { rate: taunt.rate, pitch: taunt.pitch });
            return;
        }
        const line = VOICE_LINES[key];
        if (line) speakSegments(pickOne(line.say), VOICE_STYLE[line.style]);
    } catch (e) {}
}
