// ══════════════════════════════════════════
// main.js — 字典載入、開始畫面、畫面渲染、按鈕事件
// ══════════════════════════════════════════
let DICTIONARY_SET = null;

function checkWordLocal(word) {
    if (!DICTIONARY_SET) return false;
    return DICTIONARY_SET.has(word.toLowerCase());
}

// 有效單字＝查得到中文字義的字（字義檔就是字典）
// 字義檔讀不到時（例如直接點兩下開 index.html），改用 37 萬字英文字典當備用
const DICT_URL = "https://cdn.jsdelivr.net/gh/dwyl/english-words/words_dictionary.json";

async function loadDictionary() {
    const res = await fetch(DICT_URL);
    if (!res.ok) throw new Error("字典載入失敗：" + res.status);
    if (DICT_URL.endsWith(".txt")) {
        const text = await res.text();
        DICTIONARY_SET = new Set(text.split("\n").map(w => w.trim()).filter(Boolean));
    } else {
        const data = await res.json();
        DICTIONARY_SET = new Set(Object.keys(data));
    }
    console.log("字典載入完成：", DICTIONARY_SET.size);
}

// 同時載入多益單字庫與字義，都完成後才能開始遊戲
var resourcesReady = false;
async function loadResources() {
    const btn = document.getElementById("startGameBtn");
    try {
        await Promise.all([loadWordBank(), loadMeanings()]);
        if (Object.keys(MEANINGS).length) {
            DICTIONARY_SET = new Set(Object.keys(MEANINGS));
            filterWordBankByMeanings();   // AI 只拼查得到中文意思的字
            console.log("字典（有中文字義的字）：", DICTIONARY_SET.size);
        } else {
            await loadDictionary();
        }
        btn.disabled = false;
        resourcesReady = true;
        updateStartButton();
    } catch (e) {
        console.error(e);
        btn.innerText = "❌ 資料載入失敗，請確認網路後重新整理";
    }
}

// ══════════════════════════════════════════
// 開始畫面
// ══════════════════════════════════════════
// 線上對戰在開始畫面先記成 "online-setup"，真正開始遊戲時才變成 "online"
var onlineSize = 2;
var joinCode = null;      // 從邀請連結進來的房號

function selectMode(mode) {
    gameMode = mode === "online" ? "online-setup" : mode;
    ["ai", "pvp", "four", "online"].forEach(m => {
        document.getElementById("mode-" + m).classList.toggle("active", m === mode);
    });
    updateStartOptions();
}

function selectOnlineSize(n) {
    onlineSize = n;
    [2, 4].forEach(i => document.getElementById("size-" + i).classList.toggle("active", i === n));
}

function joinByInput() {
    netJoinRoom(document.getElementById("code-input").value);
}

function updateStartButton() {
    const btn = document.getElementById("startGameBtn");
    if (!resourcesReady) return;
    if (gameMode !== "online-setup") btn.innerText = "開始遊戲 🀄";
    else btn.innerText = joinCode ? `加入房間 ${joinCode} 🀄` : "建立房間 🀄";
}

// 局數：換莊幾次結束（1/4 輪 = 1、1/2 輪 = 2、1 輪 = 4、1 將 = 16）
function selectRounds(n) {
    matchPasses = n;
    [1, 2, 4, 16].forEach(i => document.getElementById("rounds-" + i).classList.toggle("active", i === n));
}

function selectTurnTime(sec) {
    turnTimeSetting = sec;
    [15, 30, 45, 0].forEach(i => document.getElementById("time-" + i).classList.toggle("active", i === sec));
}

function selectDiff(diff) {
    aiDifficulty = diff;
    ["easy", "medium", "hard"].forEach(d => {
        document.getElementById("diff-" + d).classList.toggle("active", d === diff);
    });
}

// 線上對戰：不顯示 AI 難度；用邀請連結加入時，局數和時間由房主決定
function updateStartOptions() {
    const online = gameMode === "online-setup";
    document.getElementById("difficulty-section").hidden = online;
    document.getElementById("online-section").hidden = !online;
    document.getElementById("match-settings").hidden = online && !!joinCode;
    document.getElementById("online-size-section").hidden = !!joinCode;
    document.getElementById("join-code-row").hidden = !!joinCode;
    const banner = document.getElementById("join-banner");
    banner.hidden = !joinCode;
    if (joinCode) banner.innerText = `朋友邀請你加入房間 ${joinCode}，輸入暱稱就能加入`;
    updateStartButton();
    fitToScreen();
}

function startGame() {
    if (gameMode === "online-setup") {
        if (joinCode) netJoinRoom(joinCode); else netCreateRoom();
        return;
    }
    document.getElementById("start-screen").style.display = "none";
    document.getElementById("game-screen").style.display = "grid";
    document.getElementById("menuBtn").hidden = false;
    startMatch();
    fitToScreen();
}

function backToStart() {
    roundId++;   // 停掉舊局的計時器
    phase = "over";
    paused = false;
    stopTurnTimer();
    document.getElementById("result-overlay").classList.remove("visible");
    clearWordCards();
    document.getElementById("menu-overlay").classList.remove("visible");
    document.getElementById("menuBtn").hidden = true;
    document.getElementById("game-screen").style.display = "none";
    document.getElementById("start-screen").style.display = "flex";
    fitToScreen();
}

// ══════════════════════════════════════════
// ☰ 選單：繼續、重新開始、回主選單、音量（打開時遊戲暫停）
// ══════════════════════════════════════════
function openMenu() {
    paused = !netRole;   // 線上對戰不能暫停別人
    document.getElementById("menu-paused").hidden = !!netRole;
    document.getElementById("menu-restart").hidden = netRole === "client";
    document.getElementById("menu-overlay").classList.add("visible");
}

function closeMenu() {
    paused = false;
    document.getElementById("menu-overlay").classList.remove("visible");
}

function menuRestart() {
    closeMenu();
    startMatch();
}

function menuHome() {
    closeMenu();
    if (netRole) { netLeave(); return; }
    backToStart();
}

let volumeBeforeMute = 0.8;

function setVolume(v) {
    masterVolume = Math.max(0, Math.min(1, v));
    document.getElementById("volumeSlider").value = Math.round(masterVolume * 100);
    document.getElementById("volumeValue").innerText = Math.round(masterVolume * 100);
    document.getElementById("muteBtn").innerText = masterVolume === 0 ? "🔇" : "🔊";
    try { localStorage.setItem("em-volume", String(masterVolume)); } catch (e) {}
}

function toggleMute() {
    if (masterVolume > 0) { volumeBeforeMute = masterVolume; setVolume(0); }
    else setVolume(volumeBeforeMute || 0.8);
}

function initVolume() {
    let saved = null;
    try { saved = localStorage.getItem("em-volume"); } catch (e) {}
    setVolume(saved !== null && !isNaN(parseFloat(saved)) ? parseFloat(saved) : 0.8);
    document.getElementById("volumeSlider").oninput = (e) => {
        setVolume(e.target.value / 100);
        playSound('draw');   // 讓玩家聽到目前音量
    };
}

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || document.getElementById("menuBtn").hidden) return;
    document.getElementById("menu-overlay").classList.contains("visible") ? closeMenu() : openMenu();
});

// ══════════════════════════════════════════
// 依螢幕大小等比例縮放（手機直式版面不縮放）
// ══════════════════════════════════════════
function fitToScreen() {
    const mobile = window.innerWidth <= 720;
    document.body.classList.toggle("fit-mode", !mobile);
    [["game-screen", 2.2], ["start-card", 1.5], ["lobby-card", 1.5]].forEach(([id, maxScale]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (mobile || el.offsetParent === null) { el.style.transform = ""; return; }
        const s = Math.min(
            (window.innerWidth - 32) / el.offsetWidth,
            (window.innerHeight - 32) / el.offsetHeight,
            maxScale
        );
        el.style.transform = `scale(${s})`;
    });
}

window.addEventListener("resize", fitToScreen);
if (window.ResizeObserver) {
    // 牌桌內容變多變高時（例如亮出的牌），重新計算縮放
    const ro = new ResizeObserver(() => fitToScreen());
    window.addEventListener("load", () => {
        ["game-screen", "start-card", "lobby-card"].forEach(id => {
            const el = document.getElementById(id);
            if (el) ro.observe(el);
        });
    });
}

// ══════════════════════════════════════════
// 版面：2 人上下對坐；4 人分上、左、右、下
// ══════════════════════════════════════════
function setupTableLayout() {
    const table = document.getElementById("game-screen");
    table.classList.toggle("four-seat", seats.length === 4);
    table.classList.toggle("two-seat", seats.length === 2);
}

// 其他座位相對於畫面玩家的位置（下家在右邊）
function seatPosition(s) {
    const rel = (s - viewSeat + seats.length) % seats.length;
    if (seats.length === 2) return "top";
    return ["bottom", "right", "top", "left"][rel];
}

// ══════════════════════════════════════════
// 渲染
// ══════════════════════════════════════════
function renderAll() {
    if (!seats.length || !match) return;
    if (netRole === "host") netScheduleSync();
    renderMatchBar();
    renderSeats();
    renderBottomInfo();
    renderHand();
    renderWordZone();
    renderLastDiscard();
    updateDiscardPile();
    renderDeckCount();
    renderControls();
}

function renderDeckCount() {
    const el = document.getElementById("deck-count");
    if (el) el.innerText = allLetters.length;
}

function renderMelds(container, seat, hideConcealed) {
    container.innerHTML = "";
    seat.melds.forEach(m => {
        const group = document.createElement("div");
        group.className = "meld meld-" + m.type;
        const tag = document.createElement("span");
        tag.className = "meld-tag";
        tag.innerText = { pung: "碰", cpung: "碰", kong: "槓", ckong: "暗槓", chi: "吃" }[m.type];
        group.appendChild(tag);
        m.letters.forEach(l => {
            const t = document.createElement("div");
            const hidden = m.type === "ckong" && hideConcealed;
            t.className = "mini-tile" + (hidden ? " mini-back" : "");
            t.innerText = hidden ? "" : l;
            group.appendChild(t);
        });
        container.appendChild(group);
    });
}

// 局數列：東風圈・南局、第幾局、連莊
function renderMatchBar() {
    const bar = document.getElementById("match-bar");
    bar.innerHTML =
        `<span class="mb-round">${roundLabel()}</span>` +
        `<span class="mb-item">第 ${match.handNo} 局</span>` +
        `<span class="mb-item">${matchLengthLabel(match.target)}・換莊 ${match.passes}／${match.target}</span>` +
        (match.streak ? `<span class="mb-streak">連莊 ${match.streak}</span>` : "");
}

function makeInfoPanel(seat) {
    const panel = document.createElement("div");
    panel.className = "info-panel";
    const avatar = document.createElement("div");
    avatar.className = "avatar " + (seat.type === "ai" ? "avatar-ai" : "avatar-player");
    avatar.innerText = gameMode === "online" ? seat.name.slice(0, 1)
        : seat.type === "ai" ? "AI" : (seat.name === "我" ? "我" : "P" + (seat.id + 1));
    avatar.dataset.seat = seat.id;
    // 對手頭像：點了可以丟雞蛋／玫瑰／炸彈
    if (seat.id !== viewSeat) {
        avatar.classList.add("avatar-target");
        avatar.setAttribute("role", "button");
        avatar.tabIndex = 0;
        avatar.title = `丟東西給 ${seat.name}`;
        avatar.onclick = (e) => { e.stopPropagation(); openPropMenu(seat.id, avatar); };
        avatar.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPropMenu(seat.id, avatar); } };
    }
    const details = document.createElement("div");
    details.className = "info-details";
    details.innerHTML =
        `<span class="info-name"><span class="wind-chip">${seatWind(seat.id)}</span>${seat.name}</span>` +
        `<span class="info-count">${seat.hand.length} 張・<span class="info-score">${fmtScore(seat.score)}</span> 分</span>`;
    // 自己名字旁邊：快捷聊天
    if (seat.id === viewSeat) {
        const chat = document.createElement("button");
        chat.type = "button";
        chat.className = "chat-btn";
        chat.title = "快捷聊天";
        chat.setAttribute("aria-label", "快捷聊天");
        chat.textContent = "💬";
        chat.onclick = (e) => { e.stopPropagation(); openChatMenu(chat); };
        details.querySelector(".info-name").appendChild(chat);
    }
    panel.appendChild(avatar);
    panel.appendChild(details);

    if (seat.id === match.dealer) {
        const b = document.createElement("div");
        b.className = "dealer-badge";
        b.innerText = match.streak ? `莊 連${match.streak}` : "莊";
        panel.appendChild(b);
    }

    if (netRole && !netSeatOnline(seat.id) && seat.id !== viewSeat || seat.online === false) {
        const b = document.createElement("div");
        b.className = "listen-badge offline-badge";
        b.innerText = "斷線";
        panel.appendChild(b);
    }

    if (isListening(seat.id)) {
        const b = document.createElement("div");
        b.className = "listen-badge";
        b.innerText = "聽牌";
        panel.appendChild(b);
    }
    if (seat.id === currentSeat && phase !== "over") {
        const b = document.createElement("div");
        b.className = "turn-badge visible";
        b.innerText = "出牌中";
        panel.appendChild(b);
    }
    return panel;
}

// 最新棄牌：大張顯示，標明誰丟的、是否被碰槓吃走
let lastShownDiscardId = 0;
function renderLastDiscard() {
    const box = document.getElementById("last-discard");
    if (!recentDiscard) { box.hidden = true; return; }
    box.hidden = false;
    const from = seats[recentDiscard.from];
    const tile = document.getElementById("ld-tile");
    tile.innerText = recentDiscard.letter.toUpperCase();
    tile.classList.toggle("wildcard", recentDiscard.letter === "*");
    document.getElementById("ld-who").innerText = from.id === viewSeat && humanTotal() === 1 ? "你" : from.name;

    const action = document.getElementById("ld-action");
    if (recentDiscard.claimedBy !== null) {
        const by = seats[recentDiscard.claimedBy];
        const verb = { pung: "碰走", kong: "槓走", chi: "吃走" }[recentDiscard.claimType];
        action.innerText = `丟出 → 被 ${by.id === viewSeat && humanTotal() === 1 ? "你" : by.name} ${verb}`;
        box.classList.add("claimed");
    } else {
        action.innerText = "丟出";
        box.classList.remove("claimed");
    }

    if (recentDiscard.id !== lastShownDiscardId) {
        lastShownDiscardId = recentDiscard.id;
        box.classList.remove("pop");
        void box.offsetWidth;   // 重新觸發動畫
        box.classList.add("pop");
    }
}

function renderSeats() {
    ["top", "left", "right"].forEach(pos => {
        document.getElementById("seat-" + pos).innerHTML = "";
    });

    seats.forEach(seat => {
        if (seat.id === viewSeat) return;
        const pos = seatPosition(seat.id);
        const box = document.getElementById("seat-" + pos);
        box.classList.toggle("active-turn", seat.id === currentSeat);

        const wrap = document.createElement("div");
        wrap.className = "seat-panel" + (seat.id === currentSeat ? " active-turn" : "");
        wrap.appendChild(makeInfoPanel(seat));

        // 剛丟牌的人旁邊跳出「丟 E」
        if (recentDiscard && recentDiscard.from === seat.id && recentDiscard.claimedBy === null) {
            const bubble = document.createElement("div");
            bubble.className = "discard-bubble";
            bubble.innerHTML = `丟 <b>${recentDiscard.letter.toUpperCase()}</b>`;
            wrap.appendChild(bubble);
        }

        const melds = document.createElement("div");
        melds.className = "melds";
        renderMelds(melds, seat, true);
        wrap.appendChild(melds);

        const hand = document.createElement("div");
        hand.className = "opponent-hand" + (seats.length === 4 ? " compact" : "");
        seat.hand.forEach(() => {
            const d = document.createElement("div");
            d.className = seats.length === 4 ? "mini-tile mini-back" : "card back";
            hand.appendChild(d);
        });
        wrap.appendChild(hand);

        const words = document.createElement("div");
        words.className = "word-list";
        fillWordChips(words, seat.words, seat.name);
        wrap.appendChild(words);

        box.appendChild(wrap);
    });
}

function renderBottomInfo() {
    const seat = seats[viewSeat];
    const info = document.getElementById("player-info");
    info.innerHTML = "";
    info.appendChild(makeInfoPanel(seat));
    renderMelds(document.getElementById("player-melds"), seat, false);
    fillWordChips(document.getElementById("player-word-list"), seat.words, seat.name);
    document.getElementById("player-area").classList.toggle("active-turn", currentSeat === viewSeat);
}

function isMyAction() {
    return currentSeat === viewSeat && (phase === "turn" || phase === "mustDiscard");
}

function renderControls() {
    const myTurn = phase === "turn" && currentSeat === viewSeat;
    const mustDiscard = phase === "mustDiscard" && currentSeat === viewSeat;

    document.getElementById("discardBtn").disabled = !(myTurn || mustDiscard);
    document.getElementById("submitWord").disabled = !myTurn;
    document.getElementById("clearWord").disabled  = !myTurn;
    document.getElementById("discardBtn").innerText = discardMode && myTurn ? "取消" : "丟牌";

    const kongBtn = document.getElementById("selfKongBtn");
    kongBtn.style.display = myTurn && findSelfKong(viewSeat) ? "inline-block" : "none";
    document.getElementById("selfPungBtn").style.display = myTurn && findSelfPung(viewSeat) ? "inline-block" : "none";

    document.getElementById("cancelChiBtn").style.display = chiMode ? "inline-block" : "none";
    document.getElementById("confirmChiBtn").style.display = chiMode ? "inline-block" : "none";
}

function renderHand() {
    const hand = document.getElementById("player-hand");
    hand.innerHTML = "";
    const seat = seats[viewSeat];
    // 輪到自己出牌時，剛摸的牌固定在最右邊，並空一格標示
    // 手牌自動 A→Z 整理；輪到自己出牌時，剛摸的牌先放最右邊，回合結束後才排進去
    const myDrawTurn = phase === "turn" && currentSeat === viewSeat;
    sortHand(seat.hand);
    if (myDrawTurn) keepDrawnLast(seat.hand);

    seat.hand.forEach((tile) => {
        const div = document.createElement("div");
        div.className = "card" + (tile.letter === "*" ? " wildcard" : "");
        if (myDrawTurn && tile.id === drawnTileId) div.classList.add("drawn-tile");
        div.innerText = tile.letter;
        div.draggable = true;
        div.dataset.id = tile.id;

        if (newlyDrawnId && tile.id === newlyDrawnId) div.classList.add("deal-in");

        if (chiMode) {
            // 吃牌：選 2 張
            const isSelected = chiSelectedTiles.find(t => t.id === tile.id);
            div.classList.add(isSelected ? "chi-selected" : "chi-select");
            div.onclick = () => {
                const idx = chiSelectedTiles.findIndex(t => t.id === tile.id);
                if (idx !== -1) {
                    chiSelectedTiles.splice(idx, 1);
                    renderHand();
                } else if (chiSelectedTiles.length < 2) {
                    chiSelectedTiles.push(tile);
                    renderHand();
                }
                updateChiPreview();
            };

        } else if (discardMode && isMyAction()) {
            // 丟牌模式
            div.classList.add("discard-mode");
            div.onclick = () => {
                gameState.selectedTile = tile;
                discard();
            };

        } else {
            // 一般：點牌送入拼字區
            div.onclick = () => {
                if (!(phase === "turn" && currentSeat === viewSeat)) return;
                gameState.wordZone.push(tile);
                const i = seat.hand.findIndex(t => t.id === tile.id);
                if (i !== -1) seat.hand.splice(i, 1);
                renderHand();
                renderWordZone();
                renderBottomInfo();
            };
        }

        div.ondragstart = () => {
            if (!(phase === "turn" && currentSeat === viewSeat) || chiMode) return;
            gameState.selectedTile = tile;
        };

        hand.appendChild(div);
    });
}

function renderWordZone() {
    const zone = document.getElementById("wordArea");
    zone.innerHTML = "";
    gameState.wordZone.forEach((tile, i) => {
        const div = document.createElement("div");
        div.className = "word-card";
        div.innerText = tile.letter;
        div.onclick = () => {
            seats[viewSeat].hand.push(tile);
            gameState.wordZone.splice(i, 1);
            renderHand();
            renderWordZone();
            renderBottomInfo();
        };
        zone.appendChild(div);
    });
}

function updateDiscardPile() {
    const pile = document.getElementById("discardedLetters");
    pile.innerHTML = "";
    gameState.discardPile.forEach((letter, i) => {
        const div = document.createElement("div");
        div.className = "discard-tile";
        const isLatest = i === gameState.discardPile.length - 1
            && recentDiscard && !recentDiscard.claimedBy && recentDiscard.letter === letter;
        if (isLatest) div.classList.add("new", "latest");
        div.innerText = letter;
        pile.appendChild(div);
    });
}

// 拖曳到拼字區
const dropZone = document.getElementById("wordZone");
if (dropZone) {
    dropZone.ondragover = (e) => { e.preventDefault(); };
    dropZone.ondrop = (e) => {
        e.preventDefault();
        if (!gameState.selectedTile || !(phase === "turn" && currentSeat === viewSeat) || chiMode) return;
        const seat = seats[viewSeat];
        const i = seat.hand.findIndex(t => t.id === gameState.selectedTile.id);
        if (i === -1) return;
        gameState.wordZone.push(seat.hand[i]);
        seat.hand.splice(i, 1);
        gameState.selectedTile = null;
        renderHand();
        renderWordZone();
        renderBottomInfo();
    };
}

function clearWord() {
    returnWordZone();
    renderAll();
}

function enterDiscardMode() {
    if (phase === "mustDiscard") return;   // 碰／吃後一定要丟
    if (!(phase === "turn" && currentSeat === viewSeat)) return;
    discardMode = !discardMode;
    if (discardMode) returnWordZone();
    setMessage(discardMode ? "🗑️ 點選要丟棄的牌" : `${seats[viewSeat].name}的回合：拼字或丟牌`, true);
    renderAll();
}

document.getElementById("discardBtn").onclick = enterDiscardMode;
document.getElementById("submitWord").onclick  = submitWord;
document.getElementById("clearWord").onclick   = clearWord;
document.getElementById("selfKongBtn").onclick = selfKong;
document.getElementById("selfPungBtn").onclick = selfPung;

window.addEventListener("load", async () => {
    // 邀請連結：?room=房號 → 直接進入「加入房間」
    const room = new URLSearchParams(location.search).get("room");
    try { document.getElementById("nick-input").value = localStorage.getItem("emj-nick") || ""; } catch (e) {}
    if (room && /^[A-Za-z0-9]{5}$/.test(room)) {
        joinCode = room.toUpperCase();
        selectMode("online");
    }
    updateStartOptions();
    initVolume();
    initWheel();
    fitToScreen();
    await loadResources();
});
