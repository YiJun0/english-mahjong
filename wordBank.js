// ══════════════════════════════════════════
// wordBank.js — AI 單字庫（依多益證書等級分級，從 CDN 載入，不寫死在程式裡）
//
// 分級依據：ETS 多益分數 ↔ CEFR 對照
//   簡單 = 橘色／棕色證書（10–465 分）  ≈ CEFR A1–A2
//   普通 = 綠色／藍色證書（470–855 分） ≈ CEFR B1–B2
//   困難 = 金色證書（860–990 分）      ≈ CEFR C1 ＋ 多益職場單字 TSL
//
// 資料來源（JSON 由 xqdd/highlight-new-words 整理，CC BY-SA 4.0）：
//   - CEFR-J Wordlist 1.5（Yukio Tono, 東京外國語大學）：A1–B2
//   - Octanove Vocabulary Profile C1/C2：C1
//   - TOEIC Service List (TSL) 1.2（Browne & Culligan）：多益常考職場單字
// 不雅字過濾：LDNOOBW List of Dirty, Naughty, Obscene and Otherwise Bad Words（CC BY 4.0）
// ══════════════════════════════════════════

// 鎖定 commit，避免來源更新後內容改變
const WORD_BANK_BASE =
    "https://cdn.jsdelivr.net/gh/xqdd/highlight-new-words@6565a51cd6add2b4dfea946796cec572a77d53ea/public/data/books/";

// 每個難度：自己這一級的單字檔、以及 AI 出牌機率（其餘機率故意放棄）
const TOEIC_LEVELS = {
    easy: {
        label: "橘／棕證書單字",
        files: ["cefr-a1", "cefr-a2"],
        playRate: 0.55
    },
    medium: {
        label: "綠／藍證書單字",
        files: ["cefr-b1", "cefr-b2"],
        playRate: 0.67
    },
    hard: {
        label: "金證書單字",
        files: ["cefr-c1", "tsl"],
        playRate: 0.80
    }
};

const LEVEL_ORDER = ["easy", "medium", "hard"];

// 不雅字黑名單（AI 不會拼這些字）
const BAD_WORDS_URL =
    "https://cdn.jsdelivr.net/gh/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words@5faf2ba42d7b1c0977169ec3611df25a3c08eb13/en";

async function fetchBadWords() {
    try {
        const res = await fetch(BAD_WORDS_URL);
        if (!res.ok) throw new Error(res.status);
        const text = await res.text();
        return new Set(text.split("\n").map(w => w.trim().toLowerCase()).filter(Boolean));
    } catch (e) {
        console.warn("不雅字清單載入失敗，略過過濾", e);
        return new Set();
    }
}

// 載入後的資料：WORD_BANK[level] = 該級單字陣列（只保留純英文字母的單字）
var WORD_BANK = { easy: [], medium: [], hard: [] };
var WORD_SET = { easy: new Set(), medium: new Set(), hard: new Set() };  // 快速查詢用
var WORD_LEVEL_OF = new Map();   // 單字 → 第一次出現的等級（顯示用）

async function fetchWordFile(name) {
    const res = await fetch(WORD_BANK_BASE + name + ".json");
    if (!res.ok) throw new Error(name + " 載入失敗：" + res.status);
    const data = await res.json();
    return data.words;
}

async function loadWordBank() {
    const allFiles = LEVEL_ORDER.flatMap(lv => TOEIC_LEVELS[lv].files);
    const [badWords, ...results] = await Promise.all([fetchBadWords(), ...allFiles.map(fetchWordFile)]);
    const byFile = {};
    allFiles.forEach((f, i) => byFile[f] = results[i]);

    LEVEL_ORDER.forEach(lv => {
        const words = new Set();
        TOEIC_LEVELS[lv].files.forEach(f => {
            byFile[f].forEach(w => {
                // 只留純英文字母、至少 2 個字母的單字（不限長度）
                if (/^[a-z]{2,}$/.test(w) && !badWords.has(w)) words.add(w);
            });
        });
        WORD_BANK[lv] = [...words];
        WORD_SET[lv] = words;
        WORD_BANK[lv].forEach(w => {
            if (!WORD_LEVEL_OF.has(w)) WORD_LEVEL_OF.set(w, lv);
        });
    });

    console.log("多益單字庫載入完成：",
        LEVEL_ORDER.map(lv => `${lv} ${WORD_BANK[lv].length}`).join("、"));
}

// AI 會用的單字：自己這一級 ＋ 所有比較低的等級（金證書的人也會簡單單字）
function getKnownLevels(difficulty) {
    return LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(difficulty) + 1);
}

// AI 只拼查得到中文字義的字
function filterWordBankByMeanings() {
    LEVEL_ORDER.forEach(lv => {
        WORD_BANK[lv] = WORD_BANK[lv].filter(w => MEANINGS[w]);
        WORD_SET[lv] = new Set(WORD_BANK[lv]);
    });
}

// 是不是常用單字（任一等級的單字庫有這個字）
// 用來判斷要不要跳出「吃」：37 萬字字典裡有很多縮寫（kph、qtr），只靠字典幾乎每張牌都能吃
function isCommonWord(word) {
    return LEVEL_ORDER.some(lv => WORD_SET[lv].has(word));
}

// AI 認不認得這個字（吃牌時用）
function aiKnowsWord(word) {
    return getKnownLevels(aiDifficulty).some(lv => WORD_SET[lv].has(word));
}

function getWordLevelLabel(word) {
    const lv = WORD_LEVEL_OF.get(word);
    return lv ? TOEIC_LEVELS[lv].label : null;
}
