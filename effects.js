// ══════════════════════════════════════════
// effects.js — 吃／碰／槓 專屬特效＋音效、胡牌／自摸閃電特效
// 全部用 CSS 動畫＋Web Audio 合成，不需要額外圖片或音檔
// ══════════════════════════════════════════

const FX_STYLE = {
    chi:   { text: "吃",   cls: "fx-chi",   sound: "fxChi",   voice: "吃" },
    pung:  { text: "碰",   cls: "fx-pung",  sound: "fxPung",  voice: "碰" },
    kong:  { text: "槓",   cls: "fx-kong",  sound: "fxKong",  voice: "槓" },
    ckong: { text: "槓",   cls: "fx-kong",  sound: "fxKong",  voice: "槓" },
    akong: { text: "槓",   cls: "fx-kong",  sound: "fxKong",  voice: "槓" },
};

function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 找出某個座位在畫面上的位置（特效從那裡爆出來）
function seatAnchor(seat) {
    let el = null;
    if (seat === viewSeat) el = document.getElementById("player-hand");
    else if (typeof seatPosition === "function") el = document.getElementById("seat-" + seatPosition(seat));
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width) return { x: innerWidth / 2, y: innerHeight / 2 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function fxLayer() {
    let layer = document.getElementById("fx-layer");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "fx-layer";
        document.body.appendChild(layer);
    }
    return layer;
}

// 語音在 voice.js（fxVoice）

// 吃／碰／槓：牌桌中間（羅盤上）跳出一枚發光的徽章，再飛到那個人的頭像
function compassCenter() {
    const el = document.getElementById("compass");
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width) return { x: innerWidth / 2, y: innerHeight / 2 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function seatAvatarCenter(seat) {
    const el = document.querySelector(`.avatar[data-seat="${seat}"]`);
    const r = el && el.getBoundingClientRect();
    if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return seatAnchor(seat);
}

function makeMedal(text, cls) {
    const m = document.createElement("div");
    m.className = "fx-medal " + cls + (text.length > 1 ? " two" : "");
    m.innerHTML = `<div class="medal-flame"></div><div class="medal-coin"><span>${text}</span></div>`;
    return m;
}

function actionFx(type, seat) {
    const st = FX_STYLE[type];
    if (!st) return;
    if (netRole === "host") netBroadcast({ t: "fx", k: "action", type, seat });
    playSound(st.sound);
    fxVoice(type);

    const from = compassCenter(), to = seatAvatarCenter(seat);
    const box = document.createElement("div");
    box.className = "fx-action " + st.cls;
    box.style.left = from.x + "px";
    box.style.top = from.y + "px";
    const medal = makeMedal(st.text, "medal-" + (type === "chi" ? "green" : "gold"));
    box.appendChild(medal);

    if (!reducedMotion()) {
        const n = type === "chi" ? 12 : type === "pung" ? 16 : 24;
        for (let i = 0; i < n; i++) {
            const sp = document.createElement("i");
            sp.className = "fx-spark";
            const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
            const dist = 70 + Math.random() * 70;
            sp.style.setProperty("--dx", Math.cos(ang) * dist + "px");
            sp.style.setProperty("--dy", Math.sin(ang) * dist + "px");
            sp.style.animationDelay = (0.1 + Math.random() * 0.1) + "s";
            box.appendChild(sp);
        }
    }
    fxLayer().appendChild(box);
    if (type !== "chi") shakeTable(type === "pung" ? "small" : "big");

    // 跳出 → 停一下 → 飛到頭像、縮小
    if (box.animate && !reducedMotion()) {
        const dx = to.x - from.x, dy = to.y - from.y;
        box.animate([
            { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0 },
            { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0.55 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.9, offset: 0.9 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0, offset: 1 },
        ], { duration: 1400, easing: "ease-in-out", fill: "forwards" });
    }
    setTimeout(() => box.remove(), 1450);
}

function shakeTable(size) {
    if (reducedMotion()) return;
    const t = document.getElementById("game-screen");
    if (!t) return;
    const cls = size === "big" ? "fx-shake-big" : "fx-shake";
    t.classList.remove("fx-shake", "fx-shake-big");
    void t.offsetWidth;
    t.classList.add(cls);
    setTimeout(() => t.classList.remove(cls), 700);
}

// 隨機產生一道鋸齒閃電（SVG path）
function lightningPath(x0, y0, x1, y1, jag) {
    let d = `M${x0},${y0}`;
    const steps = 9;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = x0 + (x1 - x0) * t + (Math.random() - 0.5) * jag;
        const y = y0 + (y1 - y0) * t + (Math.random() - 0.5) * jag * 0.3;
        d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d + ` L${x1},${y1}`;
}

// 胡牌特效：kind = "ron"（胡別人的牌）或 "tsumo"（自摸）
// 時間：約 2 秒，結束後才顯示結算
const WIN_FX_MS = 2100;

function winFx(seat, kind) {
    const isTsumo = kind === "tsumo";
    if (netRole === "host") netBroadcast({ t: "fx", k: "win", seat, kind, from: lastWinFrom });
    playSound("thunder");
    setTimeout(() => playSound(isTsumo ? "fxTsumo" : "fxRon"), 300);
    setTimeout(() => fxVoice(isTsumo ? "tsumo" : "ron"), 250);

    const W = innerWidth, H = innerHeight;
    const { x, y } = seatAvatarCenter(seat);
    const ov = document.createElement("div");
    ov.className = "fx-win " + (isTsumo ? "fx-tsumo" : "fx-ron");

    // 一道主閃電從天上直直劈到胡牌的人頭上，旁邊幾道分岔；胡別人的牌再加一道從放槍的人打過來
    let bolts = "";
    const main = lightningPath(x + (Math.random() - 0.5) * 80, -30, x, y - 10, 70);
    bolts += `<path class="bolt-glow main" d="${main}"/><path class="bolt-core main" d="${main}"/>`;
    const n = reducedMotion() ? 0 : 2;
    for (let i = 0; i < n; i++) {
        const sx = x + (i ? 1 : -1) * (80 + Math.random() * 120);
        const d = lightningPath(sx, -30, x + (Math.random() - 0.5) * 40, y - 20, 90);
        const delay = (0.12 + i * 0.14).toFixed(2);
        bolts += `<path class="bolt-glow" d="${d}" style="animation-delay:${delay}s"/><path class="bolt-core" d="${d}" style="animation-delay:${delay}s"/>`;
    }
    if (!isTsumo && lastWinFrom !== null && lastWinFrom !== seat) {
        const f = seatAvatarCenter(lastWinFrom);
        const d = lightningPath(f.x, f.y, x, y, 60);
        bolts += `<path class="bolt-glow" d="${d}" style="animation-delay:.45s"/><path class="bolt-core" d="${d}" style="animation-delay:.45s"/>`;
    }

    ov.innerHTML = `
        <div class="fx-flash"></div>
        <svg class="fx-bolts" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bolts}</svg>
        <div class="fx-impact" style="left:${x}px;top:${y}px"></div>`;
    const holder = document.createElement("div");
    holder.className = "fx-win-medal";
    holder.style.left = Math.min(W - 90, Math.max(90, x)) + "px";
    holder.style.top = Math.min(H - 90, Math.max(90, y)) + "px";
    holder.appendChild(makeMedal(isTsumo ? "自摸" : "胡", "medal-red"));
    const name = seats[seat] ? seats[seat].name : "";
    holder.insertAdjacentHTML("beforeend", `<div class="fx-win-who">${name}${isTsumo ? " 自摸" : " 胡牌"}</div>`);
    ov.appendChild(holder);
    fxLayer().appendChild(ov);
    shakeTable("big");
    setTimeout(() => ov.classList.add("fx-out"), WIN_FX_MS - 300);
    setTimeout(() => ov.remove(), WIN_FX_MS + 100);
}

// 放槍的人（胡別人的牌時用）
var lastWinFrom = null;

function clearFx() {
    const layer = document.getElementById("fx-layer");
    if (layer) layer.innerHTML = "";
    if (typeof closePopMenu === "function") closePopMenu();
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
}
