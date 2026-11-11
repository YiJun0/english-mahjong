// ══════════════════════════════════════════
// match.js — 局數（莊家、連莊、圈風）、計分、思考時間倒數
// 參考明星三缺一：每個座位都當過一次莊家 = 一圈；莊家胡牌或流局就連莊
// ══════════════════════════════════════════
const WINDS = ["東", "南", "西", "北"];

var matchPasses = 4;        // 局數設定：換莊幾次結束（1/4 輪 = 1、1/2 輪 = 2、1 輪 = 4、1 將 = 16）
var turnTimeSetting = 30;   // 思考時間（秒），0 = 不限時
var match = null;           // { target, passes, round, dealer, streak, handNo, over }

// 計分
const SCORE_START = 500;    // 開場分數
const SCORE_BASE = 30;      // 底
const SCORE_PER_TILE = 10;  // 輸家每張剩牌
const SCORE_DEALER = 10;    // 莊家相關：每連莊一次多加

// ══════════════════════════════════════════
// 整場比賽
// ══════════════════════════════════════════
function startMatch() {
    createSeats();
    seats.forEach(s => { s.score = SCORE_START; });
    match = { target: matchPasses, passes: 0, round: 0, dealer: 0, streak: 0, handNo: 1, over: false };
    dealHand();
}

function nextHand() {
    if (!match || match.over) { startMatch(); return; }
    dealHand();
}

// 座位 s 的門風：莊家是東，往下家依序 南、西、北
function seatWind(s) {
    return WINDS[(s - match.dealer + seats.length) % seats.length];
}

function roundLabel() {
    return `${WINDS[match.round % 4]}風圈・${WINDS[match.dealer]}局`;
}

function matchLengthLabel(passes) {
    return { 1: "1/4 輪", 2: "1/2 輪", 4: "1 輪", 16: "1 將" }[passes] || `${passes / 4} 輪`;
}

// 一局結束：計分、決定下一局莊家
function settleHand(winner) {
    const n = seats.length;
    const deltas = new Array(n).fill(0);
    const payments = [];

    if (winner !== null) {
        seats.forEach(s => {
            if (s.id === winner) return;
            const tiles = s.hand.length;
            const dealerInvolved = winner === match.dealer || s.id === match.dealer;
            const dealerExtra = dealerInvolved ? SCORE_DEALER * (match.streak + 1) : 0;
            const pay = SCORE_BASE + SCORE_PER_TILE * tiles + dealerExtra;
            deltas[s.id] -= pay;
            deltas[winner] += pay;
            payments.push({ seat: s.id, pay, tiles, dealerExtra });
        });
    }
    seats.forEach((s, i) => { s.score += deltas[i]; });

    // 莊家胡牌或流局 → 連莊；否則換下家當莊（換莊次數到了就結束整場）
    const prevDealer = match.dealer;
    const dealerKeeps = winner === null || winner === match.dealer;
    if (dealerKeeps) {
        match.streak++;
    } else {
        match.streak = 0;
        match.passes++;
        match.dealer = (match.dealer + 1) % n;
        if (match.dealer === 0) match.round++;
    }
    match.handNo++;
    match.over = match.passes >= match.target;

    return { deltas, payments, prevDealer, dealerKeeps };
}

// ══════════════════════════════════════════
// 思考時間倒數（只算真人）
// 時間到：輪到出牌 → 自動丟出剛摸的牌；碰／吃後 → 自動丟一張；問碰槓吃 → 自動跳過
// ══════════════════════════════════════════
var turnTimer = { handle: null, remaining: 0, total: 0, kind: null, last: 0, round: 0, lastBeep: null };
var drawnTileId = null;     // 這回合摸到的牌（逾時自動丟這張）

function startTurnTimer(kind) {
    stopTurnTimer();
    if (!turnTimeSetting) return;
    const seat = seats[viewSeat];
    if (!seat || seat.type !== "human") return;

    turnTimer.total = turnTimer.remaining = turnTimeSetting * 1000;
    turnTimer.kind = kind;
    turnTimer.last = performance.now();
    turnTimer.round = roundId;
    turnTimer.lastBeep = null;
    document.getElementById("turn-timer").hidden = false;
    renderTimer();
    turnTimer.handle = setInterval(tickTimer, 100);
}

function stopTurnTimer() {
    clearRemoteTimer();
    if (turnTimer.handle) clearInterval(turnTimer.handle);
    turnTimer.handle = null;
    turnTimer.kind = null;
    const el = document.getElementById("turn-timer");
    if (el) el.hidden = true;
    if (typeof updateCompassNumber === "function" && seats.length && match) updateCompassNumber();
}

function tickTimer() {
    const now = performance.now();
    const dt = now - turnTimer.last;
    turnTimer.last = now;
    if (turnTimer.round !== roundId || phase === "over") { stopTurnTimer(); return; }
    if (paused) return;   // 選單打開時不倒數

    turnTimer.remaining -= dt;
    const sec = Math.ceil(turnTimer.remaining / 1000);
    if (sec <= 3 && sec > 0 && sec !== turnTimer.lastBeep) {
        turnTimer.lastBeep = sec;
        playSound('tick');
    }
    renderTimer();

    if (turnTimer.remaining <= 0) {
        const kind = turnTimer.kind;
        stopTurnTimer();
        onTurnTimeout(kind);
    }
}

function renderTimer() {
    const pct = Math.max(0, turnTimer.remaining / turnTimer.total) * 100;
    const sec = Math.max(0, Math.ceil(turnTimer.remaining / 1000));
    document.getElementById("tt-bar").style.width = pct + "%";
    document.getElementById("tt-sec").innerText = sec;
    document.getElementById("turn-timer").classList.toggle("urgent", sec <= 3);
    if (typeof updateCompassNumber === "function") updateCompassNumber();
}

// ── 線上對戰：房主幫其他真人計時（他們的裝置只負責顯示倒數）──
// 斷線的人不限時也會在 12 秒後自動處理，避免整桌卡住
const OFFLINE_WAIT_SEC = 12;
var remoteTimer = { handle: null, seat: null, kind: null, deadline: 0, total: 0 };

function startRemoteTimer(seat, kind) {
    clearRemoteTimer();
    const offline = typeof netSeatOnline === "function" && !netSeatOnline(seat);
    const sec = offline ? OFFLINE_WAIT_SEC : turnTimeSetting;
    if (!sec) return;
    const rid = roundId;
    remoteTimer = { handle: null, seat, kind, deadline: Date.now() + sec * 1000, total: sec * 1000 };
    remoteTimer.handle = setTimeout(() => onRemoteTimeout(seat, kind, rid), sec * 1000);
    if (typeof netScheduleSync === "function") netScheduleSync();
}

function clearRemoteTimer() {
    if (remoteTimer.handle) clearTimeout(remoteTimer.handle);
    remoteTimer = { handle: null, seat: null, kind: null, deadline: 0, total: 0 };
}

function onRemoteTimeout(seat, kind, rid) {
    if (rid !== roundId || phase === "over") return;
    remoteTimer.handle = null;
    const p = seats[seat];
    if (kind === "claim") {
        if (!activeClaim || activeClaim.seat !== seat) return;
        skipClaim();
        setMessage(`⏰ ${p.name} 時間到，自動跳過`);
        return;
    }
    if (currentSeat !== seat || phase !== "turn") return;
    const hand = p.hand;
    sortHand(hand);
    keepDrawnLast(hand);
    const tile = hand[hand.length - 1];
    if (!tile) return;
    doDiscard(seat, tile);
    setMessage(`⏰ ${p.name} 時間到，自動丟出「${tile.letter.toUpperCase()}」`);
}

function onTurnTimeout(kind) {
    if (netRole === "client") return;   // 線上對戰：由房主處理逾時
    if (kind === "claim") {
        if (!activeClaim) return;
        chiMode = false;
        chiSelectedTiles = [];
        skipClaim();
        setMessage("⏰ 時間到，自動跳過");
        return;
    }

    if (currentSeat !== viewSeat || (phase !== "turn" && phase !== "mustDiscard")) return;
    returnWordZone();
    discardMode = false;
    const hand = seats[viewSeat].hand;
    sortHand(hand);
    if (kind === "turn") keepDrawnLast(hand);
    // 輪到出牌：剛摸的牌（永遠在最右邊）；碰／吃後：最右邊那張
    const tile = hand[hand.length - 1];
    if (!tile) return;
    doDiscard(viewSeat, tile);
    setMessage(`⏰ 時間到，自動丟出「${tile.letter.toUpperCase()}」`);
}
