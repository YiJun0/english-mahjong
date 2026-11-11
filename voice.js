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
    chi:   { style: "shout", say: ["吃！", "這張我吃了！", "吃啦～謝謝！"] },
    pung:  { style: "shout", say: ["碰！", "碰啦！", "欸，這張我碰了！"] },
    kong:  { style: "shout", say: ["槓！", "槓上去啦！", "嘿嘿，槓！"] },
    ckong: { style: "shout", say: ["暗槓！", "偷偷暗槓～"] },
    akong: { style: "shout", say: ["加槓！", "再加一槓！"] },
    tsumo: { style: "big",   say: ["自摸！", "自摸啦！哈哈哈！", "不好意思，自摸～"] },
    ron:   { style: "big",   say: ["胡啦！", "謝謝放槍～胡啦！", "就等你這張！胡！"] },
};

// 聊天句：畫面上顯示原句，唸的時候加語氣詞、笑聲，再配一個搞笑音效
const TAUNT_SPEECH = [
    { say: "欸～你要想多久啊？再等下去，都要過年了啦！哈哈哈！", sfx: "slideWhistle" },
    { say: "謝謝餵牌喔～這張，我等好久了耶！嘿嘿！",            sfx: "kaching" },
    { say: "蛤？單字量就這樣喔？回家背單字啦！",                sfx: "sadTrombone" },
    { say: "拜託～快一點好不好？我花都謝了啦！",                sfx: "clock" },
    { say: "不好意思喔～這局，我要胡囉！嘿嘿嘿！",              sfx: "drumroll" },
];

// 語氣設定：rate 語速、pitch 音高（1 = 正常）
const VOICE_STYLE = {
    shout: { rate: 1.3,  pitch: 1.35 },
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
    return [...Object.keys(VOICE_LINES), ...TAUNT_SPEECH.map((_, i) => "taunt" + (i + 1))];
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
        const drawl = /^(欸|蛤|拜託|唉唷|不好意思喔)[～~？?]?$/.test(part) || (i === 0 && /[～~]$/.test(part) && part.length <= 4);
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
    if (taunt) setTimeout(() => playSound(taunt.sfx), 0);
    if (playVoiceFile(key)) return;
    try {
        if (!window.speechSynthesis) return;
        speechSynthesis.cancel();
        if (taunt) {
            // 音效先響一下再開口，比較有喜劇節奏
            setTimeout(() => speakSegments(taunt.say, VOICE_STYLE.taunt), 350);
            return;
        }
        const line = VOICE_LINES[key];
        if (line) speakSegments(pickOne(line.say), VOICE_STYLE[line.style]);
    } catch (e) {}
}
