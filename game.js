// ══════════════════════════════════════════
// game.js — 遊戲流程（座位制，支援 2 人 / 4 人）
// 發牌、回合、碰／槓／吃、聽牌、AI、流局、字根提示、音效
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// 字根提示系統（教育功能）
// ══════════════════════════════════════════
const WORD_ROOTS = {
    "act": "行動 (act=做)",   "port": "攜帶 (port=帶)",
    "struct": "建造",         "dict": "說 (dict=說)",
    "ject": "投擲",           "rupt": "破裂",
    "vis": "看見 (vis=看)",   "aud": "聽 (aud=聽)",
    "scrib": "寫",            "spec": "看 (spec=看)",
    "duc": "引導",            "ven": "來 (ven=來)",
    "pos": "放置",            "mit": "送出",
    "tract": "拉 (tract=拉)", "sect": "切割",
    "geo": "地球 (geo=土地)", "bio": "生命 (bio=生)",
    "phon": "聲音",           "graph": "寫/圖",
    "log": "語言/學問",       "path": "感覺/病",
    "mort": "死亡",           "vit": "生命",
    "bene": "好的",           "mal": "壞的",
    "uni": "一個",            "bi": "兩個",
    "tri": "三個",            "multi": "多個",
    "pre": "前面",            "post": "後面",
    "sub": "下面",            "super": "上面",
    "inter": "之間",          "trans": "穿越",
    "anti": "反對",           "auto": "自動/自己",
    "micro": "微小",          "macro": "巨大",
    "re": "再次/回",          "de": "去除/向下",
    "un": "不/反",            "dis": "不/分開",
    "ex": "出/前",            "in": "在內/不",
};

function getWordRootHint(word) {
    for (const [root, meaning] of Object.entries(WORD_ROOTS)) {
        if (word.toLowerCase().includes(root)) {
            return `📖 字根「${root}」= ${meaning}`;
        }
    }
    return null;
}

// 困難模式，或沒有 AI 的對局，才顯示字根提示
function showRootHint(word) {
    const hasAI = seats.some(s => s.type === "ai");
    if (hasAI && aiDifficulty !== "hard") return;
    const hint = getWordRootHint(word);
    const bar = document.getElementById("root-hint-bar");
    bar.innerText = hint || "";
    if (hint) setTimeout(() => { bar.innerText = ""; }, 4000);
}

// ══════════════════════════════════════════
// 音效（Web Audio API）
// ══════════════════════════════════════════
let audioCtx = null;   // 共用一個 AudioContext，避免開太多個
function playSound(type) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = audioCtx;
        if (masterVolume <= 0) return;
        const tone = (freq, dur, attack = 0.02, wave = 'sine', vol = 0.3) => {
            vol *= masterVolume;
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = wave; osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + attack);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
        };
        const chime = (freqs, gap = 0.12) => freqs.forEach((f, i) =>
            setTimeout(() => tone(f, 0.3, 0.01), i * gap * 1000));
        // 雜訊（打雷、拍桌用）
        const noise = (dur, vol, filterFreq, delay = 0, type = 'lowpass') => {
            const t0 = ctx.currentTime + delay;
            const len = Math.floor(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
            const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            src.buffer = buf; f.type = type; f.frequency.value = filterFreq;
            g.gain.value = vol * masterVolume;
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start(t0);
        };
        // 音高往下滑（銅鑼、咚）
        const sweep = (f0, f1, dur, wave = 'sine', vol = 0.35, delay = 0) => {
            const t0 = ctx.currentTime + delay;
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = wave; osc.connect(g); g.connect(ctx.destination);
            osc.frequency.setValueAtTime(f0, t0);
            osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(vol * masterVolume, t0 + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
            osc.start(t0); osc.stop(t0 + dur);
        };
        switch (type) {
            case 'draw':    tone(900, 0.08, 0.01); break;
            case 'discard': tone(450, 0.12, 0.02); break;
            case 'chi':     chime([600, 800]); break;
            case 'pung':    chime([500, 500, 750], 0.09); break;
            case 'kong':    chime([400, 500, 600, 900], 0.08); break;
            case 'success': chime([523, 659, 784]); break;
            case 'win':     chime([523, 659, 784, 1047], 0.15); break;
            case 'invalid': tone(180, 0.25, 0.01, 'sawtooth', 0.2); break;
            case 'tick':    tone(1250, 0.06, 0.005, 'sine', 0.18); break;
            case 'clack':   tone(1700, 0.03, 0.002, 'square', 0.07); break;
            case 'fanfare': chime([523, 659, 784, 1047, 1319], 0.1); break;
            // 吃：咻一聲＋兩下清脆的牌聲
            case 'fxChi':
                noise(0.18, 0.25, 2500, 0, 'bandpass');
                tone(1300, 0.08, 0.003, 'triangle', 0.22);
                setTimeout(() => tone(1650, 0.1, 0.003, 'triangle', 0.22), 90);
                break;
            // 碰：拍桌兩下（低沉的咚咚）
            case 'fxPung':
                sweep(180, 60, 0.25, 'sine', 0.55); noise(0.08, 0.5, 900);
                sweep(200, 70, 0.3, 'sine', 0.55, 0.13); noise(0.08, 0.5, 900, 0.13);
                setTimeout(() => chime([660, 880], 0.07), 280);
                break;
            // 槓：銅鑼
            case 'fxKong':
                sweep(140, 95, 1.6, 'sine', 0.5); sweep(283, 190, 1.4, 'triangle', 0.18);
                sweep(420, 300, 1.0, 'sine', 0.12); noise(0.12, 0.45, 700);
                break;
            // 打雷
            case 'thunder':
                noise(0.15, 0.9, 6000, 0, 'highpass');
                noise(1.6, 1.1, 260, 0.05);
                noise(1.2, 0.8, 150, 0.35);
                break;
            // 互動道具與聊天
            case 'whoosh':  noise(0.5, 0.35, 1200, 0, 'bandpass'); break;
            case 'splat':   noise(0.25, 0.8, 600); sweep(300, 80, 0.2, 'triangle', 0.3); break;
            case 'sparkle': chime([1319, 1568, 2093, 2637], 0.07); break;
            case 'boom':    noise(0.08, 1.0, 5000, 0, 'highpass'); noise(1.2, 1.2, 220); sweep(120, 35, 0.9, 'sine', 0.7); break;
            case 'pop':     sweep(500, 900, 0.08, 'sine', 0.25); break;
            // 嘲諷句的搞笑音效
            case 'slideWhistle': {   // 滑哨：咻～往上再往下
                const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.connect(g); g.connect(ctx.destination);
                o.frequency.setValueAtTime(500, t0);
                o.frequency.exponentialRampToValueAtTime(1800, t0 + 0.35);
                o.frequency.exponentialRampToValueAtTime(400, t0 + 0.75);
                g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.22 * masterVolume, t0 + 0.03);
                g.gain.setValueAtTime(0.22 * masterVolume, t0 + 0.65); g.gain.linearRampToValueAtTime(0, t0 + 0.8);
                o.start(t0); o.stop(t0 + 0.85);
                break;
            }
            case 'sadTrombone': {    // 悲傷長號：哇～哇～哇～哇～～
                const notes = [311, 294, 277, 262];
                notes.forEach((f, i) => {
                    const last = i === notes.length - 1;
                    const t0 = ctx.currentTime + i * 0.38, dur = last ? 1.0 : 0.34;
                    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
                    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
                    o.type = 'sawtooth'; o.frequency.value = f;
                    lp.type = 'lowpass'; lp.frequency.value = 1100;
                    if (last) { lfo.frequency.value = 6; lfoG.gain.value = 8; lfo.connect(lfoG); lfoG.connect(o.frequency); lfo.start(t0); lfo.stop(t0 + dur); }
                    o.connect(lp); lp.connect(g); g.connect(ctx.destination);
                    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16 * masterVolume, t0 + 0.05);
                    g.gain.setValueAtTime(0.16 * masterVolume, t0 + dur - 0.08); g.gain.linearRampToValueAtTime(0, t0 + dur);
                    o.start(t0); o.stop(t0 + dur + 0.02);
                });
                break;
            }
            case 'kaching':          // 收銀機：叮鈴＋零錢聲
                noise(0.12, 0.4, 3500, 0, 'bandpass');
                setTimeout(() => chime([1568, 2093, 2637], 0.05), 80);
                break;
            case 'clock':            // 時鐘：滴答滴答
                [0, 0.25, 0.5, 0.75].forEach((t, i) => setTimeout(() => tone(i % 2 ? 1500 : 1100, 0.04, 0.002, 'square', 0.12), t * 1000));
                break;
            case 'drumroll':         // 小鼓滾奏＋鈸
                for (let i = 0; i < 14; i++) noise(0.05, 0.35 + i * 0.02, 1800, i * 0.04, 'bandpass');
                noise(0.9, 0.5, 6000, 0.6, 'highpass');
                sweep(150, 60, 0.2, 'sine', 0.5, 0.6);
                break;
            case 'fxRon':   chime([392, 523, 659, 784, 1047], 0.09); break;
            case 'fxTsumo': chime([523, 659, 784, 1047, 1319, 1568], 0.08); break;
        }
    } catch (e) {}
}

// ══════════════════════════════════════════
// 小工具
// ══════════════════════════════════════════
function nextSeat(s) { return (s + 1) % seats.length; }
function prevSeat(s) { return (s - 1 + seats.length) % seats.length; }
function isListening(s) { return seats[s].hand.length <= LISTEN_LIMIT; }
function countLetter(hand, letter) { return hand.filter(t => t.letter === letter).length; }
function humanTotal() { return seats.filter(s => s.type === "human").length; }

function getAIPlayRate() {
    return TOEIC_LEVELS[aiDifficulty].playRate;
}

// 從手牌移除 n 張指定字母
function removeLetters(hand, letter, n) {
    for (let i = hand.length - 1; i >= 0 && n > 0; i--) {
        if (hand[i].letter === letter) { hand.splice(i, 1); n--; }
    }
}

function removeTilesById(hand, tiles) {
    tiles.forEach(tile => {
        const i = hand.findIndex(t => t.id === tile.id);
        if (i !== -1) hand.splice(i, 1);
    });
}

// 延遲執行：開新局或遊戲結束就取消；選單打開（暫停）時先等
function later(fn, ms) {
    const id = roundId;
    const tick = () => {
        if (id !== roundId || phase === "over") return;
        if (paused) { setTimeout(tick, 200); return; }
        fn();
    };
    setTimeout(tick, ms);
}

// local = true：只給自己看的提示（例如「點選要丟棄的牌」），線上對戰不會同步給別人
var publicMessage = "";
function setMessage(text, local = false) {
    document.getElementById("message").innerText = text;
    if (!local) {
        publicMessage = text;
        if (typeof netScheduleSync === "function") netScheduleSync();
    }
}

// 把拼字區的牌退回目前畫面玩家的手牌
function returnWordZone() {
    if (gameState.wordZone.length && seats[viewSeat]) {
        seats[viewSeat].hand.push(...gameState.wordZone);
    }
    gameState.wordZone = [];
}

// ══════════════════════════════════════════
// 建立座位與發牌
// ══════════════════════════════════════════
function createSeats() {
    // 線上對戰：全部是真人，房主自己是 human，其他人是 remote（靠連線送動作過來）
    if (gameMode === "online") {
        seats = netRoom.players.map((pl, i) => ({
            id: i, type: i === netMySeat ? "human" : "remote", name: pl.name, hand: [], words: [], melds: [],
        }));
        return;
    }
    // 對戰 AI：我 vs 對手；雙人對戰／4 人模式（測試版）：其他座位由 AI 代打，名稱用「玩家2～4」
    const total = gameMode === "four" ? 4 : 2;
    seats = [];
    for (let i = 0; i < total; i++) {
        const name = i === 0 ? "我" : gameMode === "ai" ? "對手" : `玩家${i + 1}`;
        seats.push({ id: i, type: i === 0 ? "human" : "ai", name, hand: [], words: [], melds: [] });
    }
}

function dealHand() {
    roundId++;
    stopTurnTimer();
    buildDeck();
    shuffle(allLetters);
    seats.forEach(s => { s.hand = []; s.words = []; s.melds = []; });

    gameState.wordZone = [];
    gameState.discardPile = [];
    gameState.discardOwners = [];   // 每張棄牌是誰丟的（畫面上排在那個人前面）
    gameState.selectedTile = null;
    lastDiscard = null;
    lastWinFrom = null;
    lastWinKind = null;
    clearFx();
    recentDiscard = null;
    claimQueue = [];
    activeClaim = null;
    discardMode = false;
    chiMode = false;
    chiSelectedTiles = [];
    newlyDrawnId = null;
    paused = false;
    currentSeat = match.dealer;
    viewSeat = gameMode === "online" ? netMySeat : 0;
    drawnTileId = null;
    phase = "idle";

    seats.forEach(s => {
        for (let i = 0; i < gameState.handSize; i++) s.hand.push(allLetters.pop());
    });

    document.getElementById("result-overlay").classList.remove("visible");
    document.getElementById("root-hint-bar").innerText = "";
    clearWordCards();
    hideClaimBar();
    setupTableLayout();
    renderAll();
    setMessage(`${roundLabel()}，莊家：${seats[match.dealer].name}`);
    later(() => beginTurn(match.dealer, true), 700);   // 莊家先摸牌
}

// 輪到真人：直接切到他的畫面（測試版只有一位真人，不需要換人畫面）
function showSeatTo(seat, reason, callback) {
    viewSeat = seat;
    callback();
}

// ══════════════════════════════════════════
// 回合流程
// ══════════════════════════════════════════
// draw = true：正常摸牌開始；false：碰或吃之後，不摸牌，一樣可以拼字或丟牌
function beginTurn(seat, draw) {
    stopTurnTimer();
    currentSeat = seat;
    lastDiscard = null;
    discardMode = false;
    chiMode = false;
    chiSelectedTiles = [];
    const p = seats[seat];

    if (draw) {
        if (allLetters.length === 0) { endByExhaustion(); return; }
        const tile = allLetters.pop();
        p.hand.push(tile);
        if (p.type === "human") newlyDrawnId = tile.id;
        drawnTileId = tile.id;
        playSound('draw');
    } else {
        drawnTileId = null;   // 吃／碰後沒有新摸的牌
    }

    // 線上對戰：輪到別的真人 → 等他從自己的裝置送動作過來
    if (p.type === "remote") {
        phase = "turn";
        discardMode = false;
        renderAll();
        newlyDrawnId = null;
        setMessage(draw ? `${p.name}的回合：拼字或丟牌` : `${p.name}：吃／碰成功，繼續出牌`);
        startRemoteTimer(seat, "turn");
        return;
    }

    if (p.type === "ai") {
        phase = "ai";
        renderAll();
        setMessage(`🤖 ${p.name} 思考中...`);
        later(() => aiTakeTurn(seat), aiDifficulty === "hard" ? 600 : 900);
        return;
    }

    showSeatTo(seat, "輪到你出牌", () => {
        phase = "turn";
        discardMode = false;
        renderAll();
        newlyDrawnId = null;
        const hint = findSelfKong(seat) ? "（可以槓！）" : findSelfPung(seat) ? "（可以碰！）" : "";
        setMessage(draw ? `${p.name}的回合：拼字或丟牌${hint}`
                        : `${p.name}：吃／碰成功，可以繼續拼字，拼不出來再丟牌${hint}`);
        startTurnTimer("turn");
    });
}

// 拼字成功、沒有丟牌 → 換下家
function finishTurnNoDiscard(seat) {
    stopTurnTimer();
    phase = "idle";
    later(() => beginTurn(nextSeat(seat), true), 800);
}

// kind：tsumo 自摸（自己回合拼完）／ron 胡別人的牌（吃牌拼完）→ 只影響特效
var lastWinKind = null;
function checkWin(seat, kind = "tsumo") {
    const p = seats[seat];
    const zoneEmpty = seat !== viewSeat || gameState.wordZone.length === 0;
    if (p.hand.length === 0 && zoneEmpty) {
        stopTurnTimer();
        phase = "idle";
        lastWinKind = kind;
        winFx(seat, kind);
        later(() => showResult(seat), WIN_FX_MS);
        return true;
    }
    return false;
}

// 丟牌 → 檢查其他人能不能碰槓吃
function doDiscard(seat, tile) {
    stopTurnTimer();
    const p = seats[seat];
    if (p.type === "human") returnWordZone();
    const idx = p.hand.findIndex(t => t.id === tile.id);
    if (idx === -1) return;

    p.hand.splice(idx, 1);
    gameState.discardPile.push(tile.letter);
    gameState.discardOwners.push(seat);
    lastDiscard = { letter: tile.letter, from: seat };
    recentDiscard = { id: ++discardCounter, letter: tile.letter, from: seat, claimedBy: null, claimType: null };
    gameState.selectedTile = null;
    discardMode = false;
    phase = "idle";
    playSound('discard');
    setMessage(`${p.type === "ai" ? "🤖 " : ""}${p.name} 丟了「${tile.letter.toUpperCase()}」`);
    renderAll();
    // 不能靠丟牌胡牌：丟掉最後一張、手牌變 0 張也不算胡，之後照常摸牌
    later(() => startClaims(seat), 500);
}

// 玩家點牌丟掉（含動畫）
function discard() {
    if (currentSeat !== viewSeat) return;
    if (phase !== "turn" && phase !== "mustDiscard") return;
    const tile = gameState.selectedTile;
    if (!tile) return;
    if (netRole === "client") { netClientAct({ a: "discard", id: tile.id }); return; }

    stopTurnTimer();
    const el = document.querySelector(`#player-hand .card[data-id="${tile.id}"]`);
    if (el) el.classList.add("discard-out");
    phase = "idle";
    later(() => doDiscard(viewSeat, tile), 250);
}

// ══════════════════════════════════════════
// 碰／槓／吃
// ══════════════════════════════════════════
// 2 字母單字一律用常用白名單（go、do、be…），避免冷僻縮寫
function isTwoLetterWord(w) { return TWO_LETTER_WORDS.has(w); }

// 吃牌要用的檢查：2 字母用白名單，3 字母用傳入的檢查
function chiChecker(isWord) {
    return (w) => w.length === 2 ? isTwoLetterWord(w) : isWord(w);
}

// 找出「棄牌＋手牌 1～2 張」能組成的單字：先找 3 字母（用掉 2 張），再找 2 字母（用掉 1 張）
function findChi(hand, letter, isWord) {
    const check = chiChecker(isWord);
    for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
            const word = findChiWord([letter, hand[i].letter, hand[j].letter], check);
            if (word) return { tiles: [hand[i], hand[j]], word };
        }
    }
    for (let i = 0; i < hand.length; i++) {
        const word = findChiWord([letter, hand[i].letter], check);
        if (word) return { tiles: [hand[i]], word };
    }
    return null;
}

// 目前選的牌能吃出什麼字（2 字母用白名單；3 字母先找常用單字，再用完整字典）
function chiWordForSelection() {
    if (!lastDiscard || chiSelectedTiles.length < 1 || chiSelectedTiles.length > 2) return null;
    const letters = [lastDiscard.letter, ...chiSelectedTiles.map(t => t.letter)];
    return findChiWord(letters, chiChecker(isCommonWord)) ||
           (letters.length === 3 ? findChiWord(letters, checkWordLocal) : null);
}

function chiPrompt() {
    return `選手牌中 1～2 張，和「${lastDiscard.letter.toUpperCase()}」組成單字，再按「確認吃牌」`;
}

// 選牌時即時提示能不能組成單字
function updateChiPreview() {
    const btn = document.getElementById("confirmChiBtn");
    if (chiSelectedTiles.length === 0) {
        setMessage(chiPrompt(), true);
        btn.disabled = true;
        return;
    }
    const shown = [lastDiscard.letter, ...chiSelectedTiles.map(t => t.letter)]
        .map(l => l.toUpperCase()).join("＋");
    const word = chiWordForSelection();
    setMessage(word ? `${shown} → ${word} ✓ 按「確認吃牌」` : `${shown} 組不成單字`, true);
    btn.disabled = !word;
}

function findChiWord(letters, isWord) {
    for (const combo of expandWildcards(letters)) {
        for (const perm of getPermutations(combo.split(""))) {
            const w = perm.join("");
            if (isWord(w)) return w;
        }
    }
    return null;
}

// 座位 s 對 from 丟出的牌，可以碰／槓／吃嗎？
function getClaimOptions(from, s) {
    const letter = lastDiscard.letter;
    const p = seats[s];
    const opts = {};

    if (letter !== "*") {
        const c = countLetter(p.hand, letter);
        if (c >= 3) opts.kong = true;
        if (c >= 2) opts.pung = true;
    }

    // 吃：只能吃上家（自己是丟牌者的下家），或聽牌時可吃任何人
    const isNext = s === nextSeat(from);
    if (isNext || isListening(s)) {
        // 真人：有常用單字可以組成才跳出「吃」；AI：只用自己等級認得的字
        const checker = p.type === "ai" ? aiKnowsWord : isCommonWord;
        if (findChi(p.hand, letter, checker)) {
            opts.chi = true;
            opts.chiReason = isNext ? "上家的牌" : "聽牌中";
        }
    }
    return opts;
}

function startClaims(from) {
    const pungKong = [], chiOnly = [];

    // 從下家開始依序檢查
    for (let k = 1; k < seats.length; k++) {
        const s = (from + k) % seats.length;
        const opts = getClaimOptions(from, s);
        if (opts.kong || opts.pung) pungKong.push({ seat: s, opts });
        else if (opts.chi)          chiOnly.push({ seat: s, opts });
    }

    // 碰／槓優先於吃
    claimQueue = [...pungKong, ...chiOnly];
    processNextClaim();
}

function processNextClaim() {
    stopTurnTimer();
    if (claimQueue.length === 0) {
        activeClaim = null;
        hideClaimBar();
        const from = lastDiscard.from;
        later(() => beginTurn(nextSeat(from), true), 300);
        return;
    }

    const c = claimQueue.shift();
    activeClaim = c;
    const p = seats[c.seat];

    if (p.type === "ai") {
        const action = aiDecideClaim(c);
        if (action) later(() => executeClaim(c.seat, action.type, action.tiles, action.word), 500);
        else processNextClaim();
        return;
    }

    if (p.type === "remote") {
        phase = "claim";
        hideClaimBar();
        renderAll();
        setMessage(`${seats[lastDiscard.from].name} 丟了「${lastDiscard.letter.toUpperCase()}」，等 ${p.name} 決定要不要碰槓吃…`);
        startRemoteTimer(c.seat, "claim");
        return;
    }

    const letter = lastDiscard.letter.toUpperCase();
    const reason = `${seats[lastDiscard.from].name} 丟了「${letter}」，你可以碰槓吃`;
    showSeatTo(c.seat, reason, () => {
        phase = "claim";
        renderAll();
        showClaimBar(c);
        startTurnTimer("claim");
    });
}

function showClaimBar(c) {
    const from = seats[lastDiscard.from];
    document.getElementById("claim-label").innerText =
        `${from.name} 丟了` + (c.opts.chi && !c.opts.pung ? `（${c.opts.chiReason}）` : "");
    document.getElementById("claim-tile").innerText = lastDiscard.letter.toUpperCase();
    document.getElementById("kongClaimBtn").style.display = c.opts.kong ? "inline-block" : "none";
    document.getElementById("pungBtn").style.display      = c.opts.pung ? "inline-block" : "none";
    document.getElementById("chiBtn").style.display       = c.opts.chi  ? "inline-block" : "none";
    document.getElementById("claim-bar").classList.add("visible");
    setMessage(`${seats[c.seat].name}：要碰／槓／吃嗎？`, true);
}

function hideClaimBar() {
    document.getElementById("claim-bar").classList.remove("visible");
}

function claimKong() {
    if (netRole === "client") { if (activeClaim) netClientAct({ a: "kong" }); return; }
    if (activeClaim) executeClaim(activeClaim.seat, "kong");
}
function claimPung() {
    if (netRole === "client") { if (activeClaim) netClientAct({ a: "pung" }); return; }
    if (activeClaim) executeClaim(activeClaim.seat, "pung");
}

function skipClaim() {
    if (!activeClaim) return;
    if (netRole === "client") { chiMode = false; chiSelectedTiles = []; netClientAct({ a: "skip" }); return; }
    stopTurnTimer();
    hideClaimBar();
    chiMode = false;
    chiSelectedTiles = [];
    phase = "idle";
    renderAll();
    processNextClaim();
}

function startChi() {
    if (!activeClaim) return;
    hideClaimBar();
    chiMode = true;
    chiSelectedTiles = [];
    playSound('chi');
    renderAll();
    updateChiPreview();
}

// 取消吃牌 → 回到碰槓吃選單
function cancelChi() {
    chiMode = false;
    chiSelectedTiles = [];
    renderAll();
    if (activeClaim) showClaimBar(activeClaim);
}

function confirmChi() {
    if (!chiMode || !activeClaim) return;
    const tiles = chiSelectedTiles.slice();
    const word = chiWordForSelection();
    if (word && netRole === "client") {
        netClientAct({ a: "chi", ids: tiles.map(t => t.id) });
    } else if (word) {
        executeClaim(viewSeat, "chi", tiles, word);
    } else {
        playSound('invalid');
        setMessage("❌ 組不成單字，重新選擇或按「取消吃牌」", true);
    }
}

// 手牌自動整理：A→Z 排好，★ 萬用牌放最後
function sortHand(hand) {
    const key = t => (t.letter === "*" ? "{" : t.letter);   // "{" 排在 z 後面
    hand.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

// 剛摸的牌固定放在手牌最右邊
function keepDrawnLast(hand) {
    if (!drawnTileId) return;
    const i = hand.findIndex(t => t.id === drawnTileId);
    if (i !== -1 && i !== hand.length - 1) hand.push(hand.splice(i, 1)[0]);
}

function executeClaim(seat, type, chiTiles, chiWord) {
    stopTurnTimer();
    const p = seats[seat];
    const letter = lastDiscard.letter;
    const icon = p.type === "ai" ? "🤖 " : "";

    claimQueue = [];
    activeClaim = null;
    chiMode = false;
    chiSelectedTiles = [];
    hideClaimBar();
    gameState.discardPile.pop();   // 從棄牌區拿走
    gameState.discardOwners.pop();
    if (recentDiscard) { recentDiscard.claimedBy = seat; recentDiscard.claimType = type; }

    if (type === "kong") {
        removeLetters(p.hand, letter, 3);
        p.melds.push({ type: "kong", letters: [letter, letter, letter, letter] });
        actionFx('kong', seat);
        setMessage(`${icon}${p.name} 槓！「${letter.toUpperCase()}」，補摸一張`);
    } else if (type === "pung") {
        removeLetters(p.hand, letter, 2);
        p.melds.push({ type: "pung", letters: [letter, letter, letter] });
        actionFx('pung', seat);
        setMessage(`${icon}${p.name} 碰！「${letter.toUpperCase()}」，摸一張`);
    } else {
        removeTilesById(p.hand, chiTiles);
        p.melds.push({ type: "chi", letters: chiWord.split(""), word: chiWord });
        p.words.push(chiWord);
        actionFx('chi', seat);
        showRootHint(chiWord);
        showWordCard(chiWord, `${icon}${p.name} 吃牌拼出`);
        setMessage(`${icon}${p.name} 吃！拼出 ${wordWithMeaning(chiWord)}，摸一張`);
    }

    lastWinFrom = lastDiscard.from;
    lastDiscard = null;
    phase = "idle";
    renderAll();
    if (checkWin(seat, "ron")) return;

    // 吃／碰／槓之後都要摸一張牌（槓＝補牌），再正常拼字或丟牌；丟完換下家
    later(() => beginTurn(seat, true), 900);
}

// 自己回合的槓：手上 4 張相同（暗槓），或已碰的字母摸到第 4 張（加槓）
function findSelfKong(seat) {
    const p = seats[seat];
    const counts = {};
    p.hand.forEach(t => { if (t.letter !== "*") counts[t.letter] = (counts[t.letter] || 0) + 1; });
    for (const [letter, c] of Object.entries(counts)) {
        if (c >= 4) return { letter, kind: "concealed" };
    }
    for (const m of p.melds) {
        if ((m.type === "pung" || m.type === "cpung") && counts[m.letters[0]] >= 1) return { letter: m.letters[0], kind: "added" };
    }
    return null;
}

function doSelfKong(seat) {
    const k = findSelfKong(seat);
    if (!k) return false;
    const p = seats[seat];
    const L = k.letter;

    if (k.kind === "concealed") {
        removeLetters(p.hand, L, 4);
        p.melds.push({ type: "ckong", letters: [L, L, L, L] });
    } else {
        removeLetters(p.hand, L, 1);
        const m = p.melds.find(m => (m.type === "pung" || m.type === "cpung") && m.letters[0] === L);
        m.type = "kong";
        m.letters.push(L);
    }
    actionFx(k.kind === "concealed" ? "ckong" : "akong", seat);
    setMessage(`${p.type === "ai" ? "🤖 " : ""}${p.name} ${k.kind === "concealed" ? "暗槓" : "加槓"}！「${L.toUpperCase()}」，補摸一張`);

    if (checkWin(seat)) { renderAll(); return true; }

    // 補摸
    if (allLetters.length === 0) { endByExhaustion(); return true; }
    const tile = allLetters.pop();
    p.hand.push(tile);
    if (p.type === "human") newlyDrawnId = tile.id;
    drawnTileId = tile.id;
    renderAll();
    newlyDrawnId = null;
    return true;
}

// 自己碰：手上 3 張相同字母，亮出來（跟拼出單字一樣，結束這回合、不用丟牌）
function findSelfPung(seat) {
    const counts = {};
    seats[seat].hand.forEach(t => { if (t.letter !== "*") counts[t.letter] = (counts[t.letter] || 0) + 1; });
    const hit = Object.entries(counts).find(([, c]) => c >= 3);
    return hit ? hit[0] : null;
}

// tiles：要用掉的牌（從拼字區來的已經不在手牌裡）；沒給就從手牌拿 3 張
function doSelfPung(seat, letter, tiles) {
    const p = seats[seat];
    if (!tiles) removeLetters(p.hand, letter, 3);
    p.melds.push({ type: "cpung", letters: [letter, letter, letter] });
    actionFx('pung', seat);
    const L = letter.toUpperCase();
    setMessage(`${p.type === "ai" ? "🤖 " : "🀄 "}${p.name} 碰！「${L} ${L} ${L}」`);
    renderAll();
    if (checkWin(seat)) return;
    finishTurnNoDiscard(seat);
}

function selfPung() {
    if (phase !== "turn" || currentSeat !== viewSeat) return;
    const L = findSelfPung(viewSeat);
    if (!L) return;
    if (netRole === "client") { returnWordZone(); netClientAct({ a: "selfPung" }); return; }
    returnWordZone();
    doSelfPung(viewSeat, L);
}

// 拼字區放 4 張相同字母 → 暗槓（牌已經在拼字區）
function doSelfKongFromZone(seat, letter) {
    const p = seats[seat];
    p.melds.push({ type: "ckong", letters: [letter, letter, letter, letter] });
    actionFx('ckong', seat);
    setMessage(`🀄 ${p.name} 暗槓！「${letter.toUpperCase()}」，補摸一張`);
    if (checkWin(seat)) { renderAll(); return; }
    if (allLetters.length === 0) { endByExhaustion(); return; }
    const tile = allLetters.pop();
    p.hand.push(tile);
    newlyDrawnId = tile.id;
    drawnTileId = tile.id;
    renderAll();
    newlyDrawnId = null;
    restartTurnTimerFor(seat);   // 補摸後繼續這回合
}

function selfKong() {
    if (phase !== "turn" || currentSeat !== viewSeat) return;
    returnWordZone();
    if (netRole === "client") { netClientAct({ a: "selfKong" }); return; }
    doSelfKong(viewSeat);
    if (phase === "turn") restartTurnTimerFor(viewSeat);   // 補摸後重新計時
}

// 補摸後重新計時：自己用畫面上的倒數，線上其他真人用房主端的計時
function restartTurnTimerFor(seat) {
    if (seats[seat] && seats[seat].type === "remote") startRemoteTimer(seat, "turn");
    else startTurnTimer("turn");
}

// ══════════════════════════════════════════
// AI
// ══════════════════════════════════════════
function aiTakeTurn(seat) {
    const p = seats[seat];

    {
        // 能槓就有機率槓（槓完補摸）
        if (findSelfKong(seat) && Math.random() < getAIPlayRate()) {
            doSelfKong(seat);
            if (phase === "over" || p.hand.length === 0) return;
        }

        const word = aiFindWord(p.hand);
        const pungLetter = findSelfPung(seat);
        if (pungLetter && (!word || word.length <= 3) && Math.random() < getAIPlayRate()) {
            doSelfPung(seat, pungLetter);
            return;
        }
        if (word) {
            aiRemoveWord(p.hand, word);
            p.words.push(word);
            playSound('success');
            showRootHint(word);
            showWordCard(word, `🤖 ${p.name} 拼出`);
            setMessage(`🤖 ${p.name} 拼出：${wordWithMeaning(word)}`);
            renderAll();
            if (checkWin(seat)) return;
            finishTurnNoDiscard(seat);
            return;
        }
    }
    doDiscard(seat, aiChooseDiscard(p.hand));
}

// AI 決定要不要碰槓吃（依難度有機率故意放棄）
function aiDecideClaim(c) {
    const rate = getAIPlayRate();
    const hand = seats[c.seat].hand;
    if (c.opts.kong && Math.random() < rate) return { type: "kong" };
    if (c.opts.pung && Math.random() < rate) return { type: "pung" };
    if (c.opts.chi && Math.random() < rate) {
        const found = findChi(hand, lastDiscard.letter, aiKnowsWord);
        if (found) return { type: "chi", tiles: found.tiles, word: found.word };
    }
    return null;
}

// 丟牌：優先丟只有一張的字母，保留成對的字母和萬用牌
function aiChooseDiscard(hand) {
    const singles = hand.filter(t => t.letter !== "*" && countLetter(hand, t.letter) === 1);
    const pool = singles.length ? singles : hand.filter(t => t.letter !== "*");
    const list = pool.length ? pool : hand;
    return list[Math.floor(Math.random() * list.length)];
}

// 檢查手牌能不能拼出這個字（缺的字母用萬用牌補）
function canFormWord(word, counts, wildcards) {
    const need = {};
    let missing = 0;
    for (const ch of word) {
        need[ch] = (need[ch] || 0) + 1;
        if (need[ch] > (counts[ch] || 0)) missing++;
        if (missing > wildcards) return false;
    }
    return true;
}

function aiFindWord(hand) {
    const counts = {};
    let wildcards = 0;
    hand.forEach(t => {
        if (t.letter === "*") wildcards++;
        else counts[t.letter] = (counts[t.letter] || 0) + 1;
    });

    // 從自己這一級開始找，找不到再往低等級找；同一級優先拼長的字
    const levels = getKnownLevels(aiDifficulty).reverse();
    for (const lv of levels) {
        // 不限字數：手牌拼得出來的字都算
        const candidates = WORD_BANK[lv].filter(w =>
            w.length <= hand.length && canFormWord(w, counts, wildcards)
        );
        if (candidates.length === 0) continue;

        const longest = Math.max(...candidates.map(w => w.length));
        const best = candidates.filter(w => w.length === longest);
        const word = best[Math.floor(Math.random() * best.length)];

        // 依難度有機率放棄出牌（模擬真人失誤）
        return Math.random() < getAIPlayRate() ? word : null;
    }
    return null;
}

// 移除用到的牌：先用對應字母，沒有就用萬用牌
function aiRemoveWord(hand, word) {
    word.split("").forEach(letter => {
        let idx = hand.findIndex(t => t.letter === letter);
        if (idx === -1) idx = hand.findIndex(t => t.letter === "*");
        if (idx !== -1) hand.splice(idx, 1);
    });
}

// ══════════════════════════════════════════
// 結束
// ══════════════════════════════════════════
// 牌摸完 → 流局：不計分，莊家連莊
function endByExhaustion() {
    showResult(null, true);
}

function fmtScore(n) { return n.toLocaleString("en-US"); }
function fmtDelta(n) { return n > 0 ? `+${n}` : n < 0 ? `${n}` : "0"; }

function showResult(winner, exhausted = false) {
    stopTurnTimer();
    phase = "over";
    hideClaimBar();
    chiMode = false;

    const handNo = match.handNo;
    const label = roundLabel();
    const result = settleHand(exhausted ? null : winner);
    renderAll();

    const w = winner === null || exhausted ? null : seats[winner];
    let title, subtitle;
    if (!w) {
        title = "🀫 流局";
        subtitle = `牌摸完了，本局不計分，${seats[result.prevDealer].name} 連莊`;
    } else if (gameMode === "online") {
        title = w.id === viewSeat ? "🎉 你胡牌了！" : `🎉 ${w.name} 胡牌！`;
        subtitle = `${label}（第 ${handNo} 局）`;
    } else if (w.type === "human") {
        title = humanTotal() === 1 ? "🎉 你胡牌了！" : `🎉 ${w.name} 胡牌！`;
        subtitle = `${label}（第 ${handNo} 局）`;
    } else {
        title = `😢 ${w.name} 胡牌`;
        subtitle = `${label}（第 ${handNo} 局）`;
    }
    playSound(w && (w.id === viewSeat || (gameMode !== "online" && w.type === "human")) ? 'win' : 'invalid');

    // 整場結束 → 依總分排名
    const rows = match.over ? [...seats].sort((a, b) => b.score - a.score) : seats;
    if (match.over) {
        title = "🏆 整場結束";
        subtitle = `第一名：${rows[0].name}（${fmtScore(rows[0].score)} 分）`;
    }

    document.getElementById("result-title").innerText = title;
    document.getElementById("result-subtitle").innerText = subtitle;

    const tbody = document.getElementById("result-rows");
    tbody.innerHTML = "";
    rows.forEach((s, i) => {
        const tr = document.createElement("tr");
        const isLoser = w && lastWinKind === "ron" && s.id === lastWinFrom && s.id !== w.id;
        if (w && s.id === w.id) tr.className = "winner-row";
        else if (isLoser) tr.className = "loser-row";
        const pay = result.payments.find(p => p.seat === s.id);
        const detail = pay ? `底 ${SCORE_BASE}＋剩 ${pay.tiles} 張 ${pay.tiles * SCORE_PER_TILE}` + (pay.dealerExtra ? `＋莊 ${pay.dealerExtra}` : "") : "";
        const delta = result.deltas[s.id];
        tr.innerHTML =
            `<td class="rt-name">${w && s.id === w.id ? `<span class="rt-stamp win">${lastWinKind === "tsumo" ? "自摸" : "勝"}</span>` : isLoser ? `<span class="rt-stamp lose">放槍</span>` : ""}` +
            `${match.over ? `<span class="rank">${i + 1}</span>` : ""}${s.name}` +
            `<div class="rt-words">${s.words.map(w => {
                const m = getMeaning(w).split("；")[0];
                return m ? `${w} ${m}` : w;
            }).join("、") || "—"}</div></td>` +
            `<td class="rt-num">${s.hand.length}</td>` +
            `<td class="rt-num ${delta > 0 ? "plus" : delta < 0 ? "minus" : ""}" title="${detail}">${fmtDelta(delta)}` +
            (detail ? `<div class="rt-detail">${detail}</div>` : "") + `</td>` +
            `<td class="rt-num rt-total">${fmtScore(s.score)}</td>`;
        tbody.appendChild(tr);
    });

    document.getElementById("result-next").innerText = match.over ? "" :
        `下一局：${roundLabel()}，莊家 ${seats[match.dealer].name}` + (match.streak ? `（連莊 ${match.streak}）` : "");

    const btns = document.getElementById("result-btns");
    btns.innerHTML = "";
    const primary = document.createElement("button");
    primary.innerText = match.over ? "再來一場" : "下一局";
    primary.onclick = match.over ? startMatch : nextHand;
    const home = document.createElement("button");
    home.innerText = netRole ? "離開房間" : "回主選單";
    home.onclick = netRole ? netLeave : backToStart;
    btns.append(primary, home);

    // 懲罰轉盤：雙人對戰／4 人模式，整場打完才有
    if (match.over && canUseWheel()) {
        const wheelBtn = document.createElement("button");
        wheelBtn.className = "wheel-open-btn";
        wheelBtn.innerText = "🎡 懲罰轉盤";
        wheelBtn.onclick = () => openWheel();
        btns.prepend(wheelBtn);
    }

    document.getElementById("result-overlay").classList.add("visible");
    if (netRole === "host") netBroadcastResult(winner === null || exhausted ? null : winner, label, handNo);
}
