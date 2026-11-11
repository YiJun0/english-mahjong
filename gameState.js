// ══════════════════════════════════════════
// gameState.js — 遊戲狀態與全域設定
// ══════════════════════════════════════════
const gameState = {
    discardPile: [],    // 棄牌區（字母）
    wordZone: [],       // 目前畫面上玩家的拼字區
    selectedTile: null,
    handSize: 13
};

// 遊戲設定（開始畫面選擇後寫入）
var gameMode = "ai";          // "ai" 對戰AI(2人) | "pvp" 雙人對戰 | "four" 4人模式
// 測試版：雙人對戰＝我＋1 個 AI、4 人模式＝我＋3 個 AI（AI 代替之後網站版的真人朋友）
var aiDifficulty = "easy";    // "easy" | "medium" | "hard"

// 座位：{ id, name, type:"human"|"ai", hand:[], words:[], melds:[] }
// 出牌順序 0 → 1 → 2 → 3，座位 i 的「上家」是 i-1，「下家」是 i+1
var seats = [];
var currentSeat = 0;          // 輪到誰
var viewSeat = 0;             // 畫面下方顯示哪位真人的手牌

// 階段：turn 正常回合 | mustDiscard 碰/吃後必須丟牌 | claim 等真人決定碰槓吃
//       ai AI 行動中 | idle | over 結束
var phase = "idle";
var lastDiscard = null;       // 最後一張丟出的牌 { letter, from }
var claimQueue = [];          // 等待決定碰槓吃的座位
var activeClaim = null;       // 目前在問的那位 { seat, opts }
var roundId = 0;              // 每局編號，避免舊局的計時器影響新局
var paused = false;           // 打開選單時暫停
var recentDiscard = null;     // 畫面上顯示的最新棄牌 { id, letter, from, claimedBy, claimType }
var discardCounter = 0;
var masterVolume = 0.8;       // 音量 0～1

var discardMode = false;
var chiMode = false;
var chiSelectedTiles = [];
var newlyDrawnId = null;

const LISTEN_LIMIT = 3;       // 手牌剩 3 張以下 = 聽牌
