// ══════════════════════════════════════════
// meanings.js — 單字中文字義
// 資料：data/meanings.json，由 ECDICT 開源英漢字典（MIT 授權）整理，
//       每個字義都再用 CC-CEDICT（CC BY-SA 4.0）反查確認對得上才保留，最多 3 個；
//       沒有確定的字義就是空字串（仍算有效單字），已轉為台灣繁體
// ══════════════════════════════════════════
const MEANINGS_URL = "data/meanings.json";
var MEANINGS = {};

// 字義檔載入失敗也不影響遊戲，只是不顯示字義
async function loadMeanings() {
    try {
        const res = await fetch(MEANINGS_URL);
        if (!res.ok) throw new Error(res.status);
        MEANINGS = await res.json();
        console.log("字義載入完成：", Object.keys(MEANINGS).length);
    } catch (e) {
        console.warn("字義檔載入失敗，略過字義顯示", e);
    }
}

function getMeaning(word) {
    return MEANINGS[word.toLowerCase()] || "";
}

// 訊息列用：「six（六）」，只放第一個字義
function wordWithMeaning(word) {
    const first = getMeaning(word).split("；")[0];
    return first ? `${word}（${first}）` : word;
}

// ── 單字卡：拼出單字時顯示，每張至少 3 秒，依序排隊 ──
const WORD_CARD_MS = 3000;
let wordCardTimer = null;
let wordCardQueue = [];
let wordCardBusy = false;

function showWordCard(word, who) {
    if (netRole === "host") netBroadcast({ t: "fx", k: "word", word, who });
    wordCardQueue.push({ word, who });
    if (wordCardQueue.length > 2) wordCardQueue.shift();   // 排太多就略過較舊的
    if (!wordCardBusy) nextWordCard();
}

function nextWordCard() {
    const card = document.getElementById("word-card");
    const item = wordCardQueue.shift();
    if (!card || !item) { wordCardBusy = false; if (card) card.hidden = true; return; }
    wordCardBusy = true;
    document.getElementById("wc-word").innerText = item.word;
    document.getElementById("wc-who").innerText = item.who || "";
    const meaning = getMeaning(item.word);
    const mEl = document.getElementById("wc-meaning");
    mEl.innerText = meaning;
    mEl.hidden = !meaning;   // 沒有確定的字義就留空，不硬解釋
    card.hidden = false;
    card.classList.remove("pop");
    void card.offsetWidth;   // 重新觸發動畫
    card.classList.add("pop");
    clearTimeout(wordCardTimer);
    wordCardTimer = setTimeout(nextWordCard, WORD_CARD_MS);
}

// 點單字卡：直接看下一張（沒有就關掉）
function hideWordCard() {
    clearTimeout(wordCardTimer);
    nextWordCard();
}

function clearWordCards() {
    wordCardQueue = [];
    clearTimeout(wordCardTimer);
    wordCardBusy = false;
    const card = document.getElementById("word-card");
    if (card) card.hidden = true;
}

// ── 已拼出的單字：做成可以點的小標籤，點了再看一次字義 ──
function fillWordChips(container, words, who) {
    container.innerHTML = "";
    words.forEach(w => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "word-chip";
        chip.innerText = w;
        chip.title = getMeaning(w);
        chip.onclick = (e) => { e.stopPropagation(); clearWordCards(); showWordCard(w, who); };
        container.appendChild(chip);
    });
}
