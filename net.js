// ══════════════════════════════════════════
// net.js — 線上對戰（房主制，用 PeerJS 點對點連線，不需要自己的伺服器）
//
// 流程：
//   房主按「建立房間」→ 得到房號和邀請連結 → 傳給朋友
//   朋友打開連結 → 輸入暱稱 → 加入房間
//   人數到齊，房主按「開始遊戲」（全部都是真人，不補 AI）
//
// 遊戲由房主的瀏覽器負責（發牌、判斷、計分），其他人送出動作、收到畫面狀態。
// 每個人只會收到自己的手牌，看不到別人的牌。
// ══════════════════════════════════════════

const PEER_PREFIX = "english-mahjong-";
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 沒有 0/O、1/I 容易看錯的字

var netRole = null;        // null 單機 | "host" 房主 | "client" 加入的人
var netMySeat = 0;
var netRoom = null;        // { code, size, rounds, time, players: [{ name, online, conn }] }
let netTransport = null;
let netHostConn = null;    // client：連到房主的連線
let netSyncPending = false;
let netLastStateJSON = "";
let netLastPublicMsg = "";
let netLastHandKey = "";
let netLastDiscardId = 0;
let netClientTimer = null;
let netStarted = false;

// ══════════════════════════════════════════
// 連線層：PeerJS（正式）或 BroadcastChannel（同一台電腦開兩個分頁測試用，網址加 ?net=local）
// 兩種都提供同樣的介面：conn.send(obj)、conn.onData(fn)、conn.onClose(fn)、conn.close()
// ══════════════════════════════════════════
function netParams() { return new URLSearchParams(location.search); }

function loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = PEERJS_URL;
        s.onload = resolve;
        s.onerror = () => reject(new Error("連線元件載入失敗"));
        document.head.appendChild(s);
    });
}

function peerOptions() {
    const opts = {
        debug: 1,
        config: { iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
        ] },
    };
    // 測試用：?peer=localhost:9000 改用自己架的 PeerJS 伺服器
    const custom = netParams().get("peer");
    if (custom) {
        const [host, port] = custom.split(":");
        Object.assign(opts, { host, port: +port || 9000, path: "/", secure: false });
    }
    return opts;
}

function wrapPeerConn(conn) {
    const w = {
        send: (obj) => { try { if (conn.open) conn.send(JSON.stringify(obj)); } catch (e) {} },
        onData: (fn) => conn.on("data", d => { try { fn(typeof d === "string" ? JSON.parse(d) : d); } catch (e) { console.warn(e); } }),
        onClose: (fn) => { conn.on("close", fn); conn.on("error", fn); },
        close: () => { try { conn.close(); } catch (e) {} },
    };
    return w;
}

const PeerTransport = {
    async host(code, onConn) {
        await loadPeerJS();
        return new Promise((resolve, reject) => {
            const peer = new Peer(PEER_PREFIX + code, peerOptions());
            let opened = false;
            peer.on("open", () => { opened = true; resolve({ close: () => peer.destroy() }); });
            peer.on("connection", conn => {
                conn.on("open", () => onConn(wrapPeerConn(conn)));
            });
            peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
            peer.on("error", err => {
                if (!opened) reject(err);
                else console.warn("peer error", err);
            });
        });
    },
    async join(code) {
        await loadPeerJS();
        return new Promise((resolve, reject) => {
            const peer = new Peer(peerOptions());
            let done = false;
            const fail = (msg) => { if (!done) { done = true; try { peer.destroy(); } catch (e) {} reject(new Error(msg)); } };
            const timer = setTimeout(() => fail("連不到房間（房號錯誤、房主已離開，或網路擋住了連線）"), 15000);
            peer.on("open", () => {
                const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
                conn.on("open", () => {
                    if (done) return;
                    done = true; clearTimeout(timer);
                    const w = wrapPeerConn(conn);
                    const oldClose = w.close;
                    w.close = () => { oldClose(); try { peer.destroy(); } catch (e) {} };
                    resolve(w);
                });
                conn.on("error", () => fail("連線失敗"));
            });
            peer.on("error", err => {
                fail(err && err.type === "peer-unavailable" ? "找不到這個房間（房號錯誤或房主已離開）" : "連線失敗：" + (err && err.type || err));
            });
        });
    },
};

// 本機測試：同一個瀏覽器的分頁之間用 BroadcastChannel 傳訊息
function safeChannel(name) {
    const ch = new BroadcastChannel(name);
    const raw = ch.postMessage.bind(ch);
    ch.postMessage = (m) => { try { raw(m); } catch (e) {} };
    return ch;
}

const LocalTransport = {
    async host(code, onConn) {
        const ch = safeChannel("emj-" + code);
        const conns = {};
        ch.onmessage = (e) => {
            const m = e.data;
            if (m.to !== "host") return;
            if (m.type === "open") {
                const c = { handlers: [], closers: [] };
                c.send = (obj) => ch.postMessage({ to: m.from, data: obj });
                c.onData = (fn) => c.handlers.push(fn);
                c.onClose = (fn) => c.closers.push(fn);
                c.close = () => { ch.postMessage({ to: m.from, type: "close" }); c.closers.forEach(f => f()); delete conns[m.from]; };
                conns[m.from] = c;
                ch.postMessage({ to: m.from, type: "accept" });
                onConn(c);
            } else if (m.type === "close") {
                const c = conns[m.from];
                if (c) { delete conns[m.from]; c.closers.forEach(f => f()); }
            } else if (conns[m.from]) {
                conns[m.from].handlers.forEach(f => f(m.data));
            }
        };
        window.addEventListener("beforeunload", () => Object.keys(conns).forEach(id => ch.postMessage({ to: id, type: "close" })));
        return { close: () => { Object.keys(conns).forEach(id => ch.postMessage({ to: id, type: "close" })); ch.close(); } };
    },
    async join(code) {
        const ch = safeChannel("emj-" + code);
        const id = "c" + Math.random().toString(36).slice(2, 9);
        return new Promise((resolve, reject) => {
            const c = { handlers: [], closers: [] };
            const timer = setTimeout(() => reject(new Error("找不到這個房間")), 3000);
            ch.onmessage = (e) => {
                const m = e.data;
                if (m.to !== id) return;
                if (m.type === "accept") { clearTimeout(timer); resolve(c); }
                else if (m.type === "close") c.closers.forEach(f => f());
                else c.handlers.forEach(f => f(m.data));
            };
            c.send = (obj) => ch.postMessage({ to: "host", from: id, data: obj });
            c.onData = (fn) => c.handlers.push(fn);
            c.onClose = (fn) => c.closers.push(fn);
            c.close = () => { ch.postMessage({ to: "host", from: id, type: "close" }); ch.close(); };
            window.addEventListener("beforeunload", () => ch.postMessage({ to: "host", from: id, type: "close" }));
            ch.postMessage({ to: "host", from: id, type: "open" });
        });
    },
};

function getTransport() {
    return netParams().get("net") === "local" ? LocalTransport : PeerTransport;
}

// ══════════════════════════════════════════
// 共用小工具
// ══════════════════════════════════════════
function makeRoomCode() {
    let s = "";
    for (let i = 0; i < 5; i++) s += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    return s;
}

function inviteLink(code) {
    const u = new URL(location.href);
    u.search = "";
    u.hash = "";
    u.searchParams.set("room", code);
    // 測試參數一起帶過去
    ["net", "peer"].forEach(k => { const v = netParams().get(k); if (v) u.searchParams.set(k, v); });
    return u.toString();
}

function getNickname() {
    const v = (document.getElementById("nick-input").value || "").trim().slice(0, 8);
    try { if (v) localStorage.setItem("emj-nick", v); } catch (e) {}
    return v;
}

function netSeatOnline(seat) {
    if (!netRoom || !netRoom.players[seat]) return true;
    return netRoom.players[seat].online !== false;
}

function netBroadcast(obj, exceptSeat = -1) {
    if (netRole !== "host" || !netRoom) return;
    netRoom.players.forEach((pl, i) => {
        if (i !== netMySeat && i !== exceptSeat && pl.conn && pl.online) pl.conn.send(obj);
    });
}

function netSendTo(seat, obj) {
    const pl = netRoom && netRoom.players[seat];
    if (pl && pl.conn && pl.online) pl.conn.send(obj);
}

function showStartError(msg) {
    const el = document.getElementById("online-error");
    el.innerText = msg;
    el.hidden = !msg;
}

// ══════════════════════════════════════════
// 房主：建立房間、等人、開始
// ══════════════════════════════════════════
async function netCreateRoom() {
    const name = getNickname();
    if (!name) { showStartError("請先輸入暱稱"); document.getElementById("nick-input").focus(); return; }
    showStartError("");
    const btn = document.getElementById("startGameBtn");
    btn.disabled = true;
    btn.innerText = "建立房間中…";

    netRole = "host";
    netMySeat = 0;
    netStarted = false;
    netRoom = {
        code: null, size: onlineSize, rounds: matchPasses, time: turnTimeSetting,
        players: [{ name, online: true, conn: null }],
    };

    for (let attempt = 0; attempt < 4; attempt++) {
        const code = makeRoomCode();
        try {
            netTransport = await getTransport().host(code, netOnClientConnect);
            netRoom.code = code;
            break;
        } catch (e) {
            console.warn("建立房間失敗", e);
            if (attempt === 3 || !(e && e.type === "unavailable-id")) {
                netRole = null; netRoom = null;
                btn.disabled = false;
                updateStartButton();
                showStartError("建立房間失敗：" + (e.message || e.type || e) + "（請確認網路後再試一次）");
                return;
            }
        }
    }
    btn.disabled = false;
    updateStartButton();
    showLobby();
}

function netOnClientConnect(conn) {
    // ctx.seat：這條連線目前的座位（開始前有人離開時，後面的人會往前補，所以用物件存）
    const ctx = { seat: -1 };
    conn.onData(msg => {
        if (msg.t === "hello") {
            if (ctx.seat !== -1) return;
            const name = String(msg.name || "").trim().slice(0, 8) || "玩家";
            // 斷線重連：同一個暱稱、而且那個座位現在離線 → 回到原本的位置
            const back = netRoom.players.findIndex((p, i) => i !== netMySeat && p.name === name && !p.online);
            if (back !== -1) {
                ctx.seat = back;
                Object.assign(netRoom.players[back], { online: true, conn, ctx });
                conn.send({ t: "welcome", seat: back, code: netRoom.code });
                netBroadcastLobby();
                if (netStarted) {
                    conn.send({ t: "start" });
                    netSendState(back);
                    if (phase === "over" && netLastResult) conn.send(netLastResult);
                    renderAll();
                    setMessage(`🔌 ${name} 重新連線了`);
                }
                return;
            }
            const reject = (reason) => { conn.send({ t: "reject", reason }); setTimeout(() => conn.close(), 300); };
            if (netStarted) { reject("遊戲已經開始了"); return; }
            if (netRoom.players.some(p => p.name === name)) { reject("這個暱稱已經有人用了，換一個吧"); return; }
            if (netRoom.players.length >= netRoom.size) { reject("房間已經滿了"); return; }
            ctx.seat = netRoom.players.length;
            netRoom.players.push({ name, online: true, conn, ctx });
            conn.send({ t: "welcome", seat: ctx.seat, code: netRoom.code });
            playSound("pop");
            netBroadcastLobby();
            return;
        }
        if (ctx.seat === -1) return;
        if (msg.t === "leave") { gone(); return; }   // 對方關掉分頁前會先說一聲
        netHandleClientMessage(ctx.seat, msg);
    });
    conn.onClose(() => gone());
    function gone() {
        const seat = ctx.seat;
        if (seat === -1 || !netRoom || !netRoom.players[seat] || netRoom.players[seat].conn !== conn) return;
        const pl = netRoom.players[seat];
        if (!netStarted) {
            // 還沒開始：直接移出房間，後面的人往前補
            netRoom.players.splice(seat, 1);
            ctx.seat = -1;
            netRoom.players.forEach((p, i) => {
                if (p.ctx && p.ctx.seat !== i) {
                    p.ctx.seat = i;
                    if (p.conn) p.conn.send({ t: "welcome", seat: i, code: netRoom.code });
                }
            });
            netBroadcastLobby();
            return;
        }
        pl.online = false;
        pl.conn = null;
        renderAll();
        setMessage(`⚠️ ${pl.name} 斷線了，輪到他時會自動出牌（重新打開連結可以回來）`);
        // 正在等他 → 開始倒數，避免整桌卡住
        if (phase === "turn" && currentSeat === seat) startRemoteTimer(seat, "turn");
        else if (phase === "claim" && activeClaim && activeClaim.seat === seat) startRemoteTimer(seat, "claim");
        netBroadcastLobby();
    }
}

function netBroadcastLobby() {
    const info = {
        t: "lobby", code: netRoom.code, size: netRoom.size, rounds: netRoom.rounds, time: netRoom.time,
        players: netRoom.players.map(p => ({ name: p.name, online: p.online !== false })),
        started: netStarted,
    };
    netBroadcast(info);
    renderLobby(info);
}

function netHostStart() {
    if (netRole !== "host" || netRoom.players.length < netRoom.size) return;
    netStarted = true;
    gameMode = "online";
    matchPasses = netRoom.rounds;
    turnTimeSetting = netRoom.time;
    netBroadcast({ t: "start" });
    hideLobby();
    startGame();
}

// ══════════════════════════════════════════
// 房主：同步畫面狀態給每個人（每個人只看得到自己的手牌）
// ══════════════════════════════════════════
function netScheduleSync() {
    if (netRole !== "host" || !netStarted || netSyncPending) return;
    netSyncPending = true;
    setTimeout(() => {
        netSyncPending = false;
        netRoom.players.forEach((p, i) => { if (i !== netMySeat) netSendState(i); });
    }, 30);
}

function netSendState(seat) {
    if (!seats.length || !match) return;
    const timer = remoteTimer.seat === seat && remoteTimer.deadline
        ? { remaining: Math.max(0, remoteTimer.deadline - Date.now()), total: remoteTimer.total, kind: remoteTimer.kind }
        : null;
    netSendTo(seat, {
        t: "state",
        you: seat,
        roundId,
        seats: seats.map(s => ({
            id: s.id, name: s.name, score: s.score, words: s.words, melds: s.melds,
            online: netSeatOnline(s.id),
            hand: s.id === seat ? s.hand : s.hand.length,
        })),
        match,
        phase: phase === "ai" ? "idle" : phase,
        currentSeat,
        lastDiscard,
        recentDiscard,
        discardPile: gameState.discardPile,
        discardOwners: gameState.discardOwners,
        deck: allLetters.length,
        drawnTileId: currentSeat === seat ? drawnTileId : null,
        claim: activeClaim && activeClaim.seat === seat && phase === "claim" ? activeClaim : null,
        msg: publicMessage,
        timer,
        turnTime: turnTimeSetting,
    });
}

var netLastResult = null;
function netBroadcastResult(winner, label, handNo) {
    netLastResult = {
        t: "result",
        winner,
        over: match.over,
        exhaustedDealer: winner === null ? seats[(match.dealer) % seats.length].name : null,
        subtitle: document.getElementById("result-subtitle").innerText,
        title: document.getElementById("result-title").innerText,
        rows: document.getElementById("result-rows").innerHTML,
        next: document.getElementById("result-next").innerText,
        handNo,
    };
    netBroadcast(netLastResult);
}

// ══════════════════════════════════════════
// 房主：處理別人送來的動作（先檢查是不是輪到他）
// ══════════════════════════════════════════
function netHandleClientMessage(seat, msg) {
    if (msg.t === "act") { netHandleAction(seat, msg); return; }
    if (msg.t === "prop") {
        if (!seats[msg.to] || msg.to === seat || !PROPS[msg.type]) return;
        netBroadcast({ t: "prop", from: seat, to: msg.to, type: msg.type }, seat);
        playProp(seat, msg.to, msg.type);
        return;
    }
    if (msg.t === "chat") {
        if (!TAUNTS[msg.idx]) return;
        netBroadcast({ t: "chat", seat, idx: msg.idx }, seat);
        showChat(seat, msg.idx);
        return;
    }
    if (msg.t === "wheelOpen") {
        netBroadcast({ t: "wheelOpen" }, seat);
        openWheel(true);
        return;
    }
    if (msg.t === "wheelSpin") {
        if (!wheel.spinner || wheel.spinner.id !== seat) return;
        netBroadcast({ t: "wheelSpin", p: msg.p, r: msg.r }, seat);
        netReceiveWheelSpin(msg.p, msg.r);
    }
}

function netReject(seat, text) {
    netSendTo(seat, { t: "err", msg: text });
}

function netHandleAction(seat, msg) {
    if (phase === "over") return;
    const p = seats[seat];
    if (!p) return;
    const takeTiles = (ids) => {
        if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return null;
        const tiles = ids.map(id => p.hand.find(t => t.id === id));
        if (tiles.some(t => !t)) return null;
        return tiles;
    };

    // ── 碰槓吃 ──
    if (["pung", "kong", "chi", "skip"].includes(msg.a)) {
        if (phase !== "claim" || !activeClaim || activeClaim.seat !== seat) return;
        const o = activeClaim.opts;
        if (msg.a === "skip") { skipClaim(); return; }
        if (msg.a === "pung" && o.pung) { executeClaim(seat, "pung"); return; }
        if (msg.a === "kong" && o.kong) { executeClaim(seat, "kong"); return; }
        if (msg.a === "chi" && o.chi) {
            const tiles = takeTiles(msg.ids);
            if (!tiles || tiles.length > 2) { netReject(seat, "❌ 吃牌要選 1～2 張"); return; }
            const letters = [lastDiscard.letter, ...tiles.map(t => t.letter)];
            const word = findChiWord(letters, chiChecker(isCommonWord)) ||
                         (letters.length === 3 ? findChiWord(letters, checkWordLocal) : null);
            if (!word) { netReject(seat, "❌ 組不成單字，重新選擇或按「取消吃牌」"); return; }
            executeClaim(seat, "chi", tiles, word);
        }
        return;
    }

    // ── 自己的回合 ──
    if (phase !== "turn" || currentSeat !== seat) return;
    if (msg.a === "discard") {
        const tile = p.hand.find(t => t.id === msg.id);
        if (tile) doDiscard(seat, tile);
        return;
    }
    if (msg.a === "word") {
        const tiles = takeTiles(msg.ids);
        if (!tiles) return;
        removeTilesById(p.hand, tiles);
        const r = applySpell(seat, tiles);
        if (!r.ok) {
            p.hand.push(...tiles);
            netReject(seat, r.msg);
            netSendState(seat);
        }
        return;
    }
    if (msg.a === "selfPung") {
        const L = findSelfPung(seat);
        if (L) doSelfPung(seat, L);
        return;
    }
    if (msg.a === "selfKong") {
        if (doSelfKong(seat) && phase === "turn") startRemoteTimer(seat, "turn");
    }
}

// ══════════════════════════════════════════
// 加入的人：連線、收狀態、送動作
// ══════════════════════════════════════════
async function netJoinRoom(code) {
    const name = getNickname();
    if (!name) { showStartError("請先輸入暱稱"); document.getElementById("nick-input").focus(); return; }
    code = (code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { showStartError("房號是 5 個英文字母或數字"); return; }
    showStartError("");
    const btn = document.getElementById("startGameBtn");
    btn.disabled = true;
    btn.innerText = "連線中…";
    try {
        netHostConn = await getTransport().join(code);
    } catch (e) {
        btn.disabled = false;
        updateStartButton();
        showStartError(e.message || "連線失敗");
        return;
    }
    netRole = "client";
    netStarted = false;
    netRoom = { code, players: [] };
    netHostConn.onData(netOnHostMessage);
    netHostConn.onClose(() => {
        if (netRole !== "client") return;
        netRole = null;
        netShowDisconnected("和房主的連線中斷了（房主可能離開了，或網路不穩）");
    });
    netHostConn.send({ t: "hello", name });
    btn.disabled = false;
    updateStartButton();
}

function netOnHostMessage(msg) {
    switch (msg.t) {
        case "welcome":
            netMySeat = msg.seat;
            netRoom.code = msg.code;
            showLobby();
            break;
        case "reject":
            netRole = null;
            hideLobby();
            showStartError(msg.reason);
            try { netHostConn.close(); } catch (e) {}
            break;
        case "lobby":
            Object.assign(netRoom, { size: msg.size, rounds: msg.rounds, time: msg.time, players: msg.players });
            renderLobby(msg);
            break;
        case "start":
            netStarted = true;
            gameMode = "online";
            hideLobby();
            document.getElementById("start-screen").style.display = "none";
            document.getElementById("game-screen").style.display = "grid";
            document.getElementById("menuBtn").hidden = false;
            fitToScreenSoon();
            break;
        case "state":
            netApplyState(msg);
            break;
        case "err":
            playSound("invalid");
            setMessage(msg.msg, true);
            break;
        case "fx":
            if (msg.k === "action") actionFx(msg.type, msg.seat);
            else if (msg.k === "win") { lastWinFrom = msg.from; winFx(msg.seat, msg.kind); }
            else if (msg.k === "word") showWordCard(msg.word, msg.who);
            break;
        case "prop":
            playProp(msg.from, msg.to, msg.type);
            break;
        case "chat":
            showChat(msg.seat, msg.idx);
            break;
        case "result":
            netShowResult(msg);
            break;
        case "wheelOpen":
            openWheel(true);
            break;
        case "wheelSpin":
            netReceiveWheelSpin(msg.p, msg.r);
            break;
        case "bye":
            netRole = null;
            netShowDisconnected(msg.reason || "房主結束了房間");
            break;
    }
}

function netClientAct(obj) {
    if (!netHostConn) return;
    netHostConn.send({ t: "act", ...obj });
    if (obj.a === "discard") {
        discardMode = false;
        gameState.selectedTile = null;
    }
    if (["pung", "kong", "chi", "skip"].includes(obj.a)) hideClaimBar();
}

function netApplyState(s) {
    const json = JSON.stringify(s);
    if (json === netLastStateJSON) return;
    netLastStateJSON = json;

    const prevPhase = phase, prevSeat = currentSeat, prevRound = roundId;
    roundId = s.roundId;
    viewSeat = s.you;
    netMySeat = s.you;
    match = s.match;
    turnTimeSetting = s.turnTime;
    seats = s.seats.map(x => ({
        id: x.id, name: x.name, score: x.score, words: x.words, melds: x.melds,
        type: x.id === s.you ? "human" : "remote", online: x.online,
        hand: x.id === s.you ? x.hand : Array.from({ length: x.hand }, (_, i) => ({ id: -1 - i, letter: "?" })),
    }));
    phase = s.phase;
    currentSeat = s.currentSeat;
    lastDiscard = s.lastDiscard;
    recentDiscard = s.recentDiscard;
    gameState.discardPile = s.discardPile;
    gameState.discardOwners = s.discardOwners || [];
    allLetters = { length: s.deck };
    drawnTileId = s.drawnTileId;

    // 新的一局：清掉上一局的畫面狀態
    const handKey = String(s.roundId);   // 每開新的一局，房主的 roundId 就會加 1
    if (handKey !== netLastHandKey) {
        netLastHandKey = handKey;
        gameState.wordZone = [];
        chiMode = false; chiSelectedTiles = []; discardMode = false;
        document.getElementById("result-overlay").classList.remove("visible");
        closeWheel();
        clearWordCards();
        clearFx();
        setupTableLayout();
        document.getElementById("root-hint-bar").innerText = "";
    }

    // 拼字區的牌：還在手上的就從手牌拿掉（留在拼字區）；已經不在手上的（拼出去了）就清掉
    const me = seats[s.you];
    const handIds = new Set(me.hand.map(t => t.id));
    gameState.wordZone = gameState.wordZone.filter(t => handIds.has(t.id));
    const zoneIds = new Set(gameState.wordZone.map(t => t.id));
    me.hand = me.hand.filter(t => !zoneIds.has(t.id));

    const myTurn = phase === "turn" && currentSeat === s.you;
    if (!myTurn) {
        if (gameState.wordZone.length) { me.hand.push(...gameState.wordZone); gameState.wordZone = []; }
        discardMode = false;
    }
    // 剛摸到牌：播放發牌動畫
    if (myTurn && (prevPhase !== "turn" || prevSeat !== s.you) && drawnTileId !== null) {
        newlyDrawnId = drawnTileId;
        playSound("draw");
    }

    // 碰槓吃：輪到我決定
    activeClaim = s.claim;
    if (activeClaim && phase === "claim") {
        if (!chiMode) showClaimBar(activeClaim);
    } else {
        hideClaimBar();
        chiMode = false; chiSelectedTiles = [];
    }

    if (recentDiscard && recentDiscard.id !== netLastDiscardId) {
        netLastDiscardId = recentDiscard.id;
        if (recentDiscard.from !== s.you) playSound("discard");
    }

    if (phase !== "over" && document.getElementById("result-overlay").classList.contains("visible") && prevRound !== roundId) {
        document.getElementById("result-overlay").classList.remove("visible");
    }

    renderAll();
    newlyDrawnId = null;
    // 訊息列：有新的公開訊息才更新（不要蓋掉自己的提示，例如「點選要丟棄的牌」）
    if (s.msg !== netLastPublicMsg) {
        netLastPublicMsg = s.msg;
        if (!(activeClaim && phase === "claim")) setMessage(s.msg, true);
    }
    netRunClientTimer(s.timer);
    fitToScreen();
}

// 自己的思考時間（只是顯示，真正逾時由房主處理）
function netRunClientTimer(t) {
    clearInterval(netClientTimer);
    netClientTimer = null;
    const el = document.getElementById("turn-timer");
    if (!t) { el.hidden = true; updateCompassNumber(); return; }
    const deadline = performance.now() + t.remaining;
    let lastBeep = null;
    const draw = () => {
        const remaining = deadline - performance.now();
        turnTimer.total = t.total;
        turnTimer.remaining = remaining;
        renderTimer();
        const sec = Math.ceil(remaining / 1000);
        if (sec <= 3 && sec > 0 && sec !== lastBeep) { lastBeep = sec; playSound("tick"); }
        if (remaining <= 0) { clearInterval(netClientTimer); netClientTimer = null; }
    };
    el.hidden = false;
    draw();
    netClientTimer = setInterval(draw, 100);
}

function netShowResult(r) {
    stopTurnTimer();
    clearInterval(netClientTimer);
    hideClaimBar();
    let title = r.title;
    if (!r.over && r.winner !== null && r.winner !== undefined && seats[r.winner]) {
        title = r.winner === viewSeat ? "🎉 你胡牌了！" : `🎉 ${seats[r.winner].name} 胡牌！`;
    }
    playSound(r.winner === viewSeat ? "win" : "invalid");
    document.getElementById("result-title").innerText = title;
    document.getElementById("result-subtitle").innerText = r.subtitle;
    document.getElementById("result-rows").innerHTML = r.rows;
    document.getElementById("result-next").innerText = r.next;
    const btns = document.getElementById("result-btns");
    btns.innerHTML = "";
    const wait = document.createElement("button");
    wait.disabled = true;
    wait.innerText = r.over ? "等房主決定要不要再來一場…" : "等房主開下一局…";
    const leave = document.createElement("button");
    leave.innerText = "離開房間";
    leave.onclick = netLeave;
    btns.append(wait, leave);
    if (r.over) {
        const wheelBtn = document.createElement("button");
        wheelBtn.className = "wheel-open-btn";
        wheelBtn.innerText = "🎡 懲罰轉盤";
        wheelBtn.onclick = () => openWheel();
        btns.prepend(wheelBtn);
    }
    document.getElementById("result-overlay").classList.add("visible");
}

// ── 道具、聊天、轉盤：送出去 ──
function netSendProp(from, to, type) {
    if (netRole === "client") netHostConn && netHostConn.send({ t: "prop", to, type });
    else netBroadcast({ t: "prop", from, to, type });
}
function netSendChat(seat, idx) {
    if (netRole === "client") netHostConn && netHostConn.send({ t: "chat", idx });
    else netBroadcast({ t: "chat", seat, idx });
}
function netSendWheelOpen() {
    if (netRole === "client") netHostConn && netHostConn.send({ t: "wheelOpen" });
    else netBroadcast({ t: "wheelOpen" });
}
function netSendWheelSpin(p, r) {
    if (netRole === "client") netHostConn && netHostConn.send({ t: "wheelSpin", p, r });
    else netBroadcast({ t: "wheelSpin", p, r });
}
function netReceiveWheelSpin(p, r) {
    if (!document.getElementById("wheel-overlay").classList.contains("visible")) openWheel(true);
    setLever(0);
    spinWheel(p, r);
}

// ══════════════════════════════════════════
// 離開、斷線
// ══════════════════════════════════════════
function netLeave() {
    if (netRole === "host") {
        netBroadcast({ t: "bye", reason: "房主離開了，房間已關閉" });
        setTimeout(() => { try { netTransport && netTransport.close(); } catch (e) {} }, 300);
    } else if (netRole === "client") {
        try { netHostConn && netHostConn.send({ t: "leave" }); } catch (e) {}
        const c = netHostConn;
        setTimeout(() => { try { c && c.close(); } catch (e) {} }, 200);
    }
    netReset();
    hideLobby();
    backToStart();
}

function netReset() {
    netRole = null;
    netRoom = null;
    netHostConn = null;
    netTransport = null;
    netStarted = false;
    netLastStateJSON = "";
    netLastPublicMsg = "";
    netLastHandKey = "";
    clearInterval(netClientTimer);
    if (gameMode === "online") gameMode = "four";
    // 網址上的房號拿掉，避免重新整理又加入
    try {
        const u = new URL(location.href);
        if (u.searchParams.has("room")) { u.searchParams.delete("room"); history.replaceState(null, "", u.toString()); }
    } catch (e) {}
    joinCode = null;
    selectMode("online");
}

function netShowDisconnected(text) {
    clearInterval(netClientTimer);
    roundId++;
    phase = "over";
    document.getElementById("net-alert-text").innerText = text;
    document.getElementById("net-alert").classList.add("visible");
}

function netAlertOk() {
    document.getElementById("net-alert").classList.remove("visible");
    netReset();
    hideLobby();
    backToStart();
}

// ══════════════════════════════════════════
// 大廳畫面
// ══════════════════════════════════════════
function showLobby() {
    document.getElementById("start-card").hidden = true;
    document.getElementById("lobby-card").hidden = false;
    const link = inviteLink(netRoom.code);
    document.getElementById("lobby-code").innerText = netRoom.code;
    document.getElementById("invite-link").value = link;
    document.getElementById("lobby-host-only").hidden = netRole !== "host";
    document.getElementById("lobby-start").hidden = netRole !== "host";
    document.getElementById("lobby-share-btn").hidden = !navigator.share;
    if (netRole === "host") netBroadcastLobby();
    fitToScreen();
}

function hideLobby() {
    document.getElementById("lobby-card").hidden = true;
    document.getElementById("start-card").hidden = false;
    fitToScreen();
}

function renderLobby(info) {
    if (!document.getElementById("lobby-card") || document.getElementById("lobby-card").hidden) return;
    const size = info.size || 2;
    document.getElementById("lobby-sub").innerText =
        `${size} 人・${matchLengthLabel(info.rounds)}・${info.time ? info.time + " 秒" : "不限時"}`;
    const list = document.getElementById("lobby-players");
    list.innerHTML = "";
    for (let i = 0; i < size; i++) {
        const p = info.players[i];
        const li = document.createElement("li");
        li.className = "lobby-seat" + (p ? "" : " empty") + (i === netMySeat && p ? " me" : "");
        li.innerHTML = p
            ? `<span class="lobby-avatar">${escapeHtml(p.name.slice(0, 1))}</span><span class="lobby-name">${escapeHtml(p.name)}</span>` +
              `${i === 0 ? '<span class="lobby-tag">房主</span>' : ""}${i === netMySeat ? '<span class="lobby-tag me">你</span>' : ""}` +
              `${p.online === false ? '<span class="lobby-tag off">斷線</span>' : ""}`
            : `<span class="lobby-avatar">？</span><span class="lobby-name">等待加入…</span>`;
        list.appendChild(li);
    }
    const n = info.players.length;
    const full = n >= size;
    document.getElementById("lobby-status").innerText = full
        ? (netRole === "host" ? "人到齊了，可以開始！" : "人到齊了，等房主開始…")
        : `等待玩家加入（${n}／${size}）・人到齊才能開始`;
    const start = document.getElementById("lobby-start");
    start.disabled = !full;
    start.innerText = full ? "開始遊戲 🀄" : `還差 ${size - n} 人`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function netCopyLink() {
    const input = document.getElementById("invite-link");
    const btn = document.getElementById("lobby-copy-btn");
    try {
        await navigator.clipboard.writeText(input.value);
    } catch (e) {
        input.select();
        try { document.execCommand("copy"); } catch (e2) {}
    }
    btn.innerText = "已複製 ✓";
    setTimeout(() => { btn.innerText = "複製連結"; }, 1500);
}

function netShareLink() {
    if (!navigator.share) return;
    navigator.share({
        title: "英文麻將",
        text: `來玩英文麻將！房號 ${netRoom.code}`,
        url: document.getElementById("invite-link").value,
    }).catch(() => {});
}

// 關掉分頁時先通知（WebRTC 自己偵測斷線要等好幾秒）
function netNotifyLeaving() {
    if (netRole === "host") netBroadcast({ t: "bye", reason: "房主離開了，房間已關閉" });
    else if (netRole === "client" && netHostConn) netHostConn.send({ t: "leave" });
}
window.addEventListener("beforeunload", netNotifyLeaving);
window.addEventListener("pagehide", netNotifyLeaving);
