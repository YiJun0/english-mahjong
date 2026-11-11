// ══════════════════════════════════════════
// effects.js — 吃／碰／槓 專屬特效＋音效、胡牌／自摸閃電特效
// 全部用 CSS 動畫＋Web Audio 合成，不需要額外圖片或音檔
// ══════════════════════════════════════════

const FX_STYLE = {
    chi:   { text: "吃",   cls: "fx-chi",   sound: "fxChi",   voice: "吃" },
    pung:  { text: "碰",   cls: "fx-pung",  sound: "fxPung",  voice: "碰" },
    kong:  { text: "槓",   cls: "fx-kong",  sound: "fxKong",  voice: "槓" },
    ckong: { text: "暗槓", cls: "fx-kong",  sound: "fxKong",  voice: "暗槓" },
    akong: { text: "加槓", cls: "fx-kong",  sound: "fxKong",  voice: "加槓" },
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

// 吃／碰／槓：大字＋光圈＋火花
function actionFx(type, seat) {
    const st = FX_STYLE[type];
    if (!st) return;
    if (netRole === "host") netBroadcast({ t: "fx", k: "action", type, seat });
    playSound(st.sound);
    fxVoice(type);

    const { x, y } = seatAnchor(seat);
    const box = document.createElement("div");
    box.className = `fx-action ${st.cls}`;
    // 不要貼到畫面邊緣
    box.style.left = Math.min(innerWidth - 110, Math.max(110, x)) + "px";
    box.style.top = Math.min(innerHeight - 90, Math.max(90, y)) + "px";
    box.innerHTML = `<div class="fx-rays"></div><div class="fx-ring"></div><div class="fx-word">${st.text}</div>`;

    if (!reducedMotion()) {
        const n = type === "chi" ? 10 : type === "pung" ? 14 : 22;
        for (let i = 0; i < n; i++) {
            const s = document.createElement("i");
            s.className = "fx-spark";
            const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
            const dist = 70 + Math.random() * (type === "chi" ? 50 : 90);
            s.style.setProperty("--dx", Math.cos(ang) * dist + "px");
            s.style.setProperty("--dy", Math.sin(ang) * dist + "px");
            s.style.animationDelay = Math.random() * 0.08 + "s";
            box.appendChild(s);
        }
    }
    fxLayer().appendChild(box);
    if (type !== "chi") shakeTable(type === "pung" ? "small" : "big");
    setTimeout(() => box.remove(), 1300);
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
    setTimeout(() => playSound(isTsumo ? "fxTsumo" : "fxRon"), 250);
    setTimeout(() => fxVoice(isTsumo ? "tsumo" : "ron"), 200);

    const W = innerWidth, H = innerHeight;
    const { x, y } = seatAnchor(seat);
    const ov = document.createElement("div");
    ov.className = "fx-win " + (isTsumo ? "fx-tsumo" : "fx-ron");

    // 閃電：自摸從天上劈到自己；胡別人的牌多一道從放槍的人那裡打過來
    let bolts = "";
    const n = reducedMotion() ? 1 : isTsumo ? 4 : 3;
    for (let i = 0; i < n; i++) {
        const sx = isTsumo ? x + (Math.random() - 0.5) * W * 0.7 : Math.random() * W;
        const d = lightningPath(sx, -20, x + (Math.random() - 0.5) * 60, y, 110);
        const delay = (i * 0.16).toFixed(2);
        bolts += `<path class="bolt-glow" d="${d}" style="animation-delay:${delay}s"/>
                  <path class="bolt-core" d="${d}" style="animation-delay:${delay}s"/>`;
    }
    if (!isTsumo && lastWinFrom !== null && lastWinFrom !== seat) {
        const f = seatAnchor(lastWinFrom);
        const d = lightningPath(f.x, f.y, x, y, 70);
        bolts += `<path class="bolt-glow" d="${d}" style="animation-delay:.5s"/>
                  <path class="bolt-core" d="${d}" style="animation-delay:.5s"/>`;
    }

    const name = seats[seat] ? seats[seat].name : "";
    ov.innerHTML = `
        <div class="fx-flash"></div>
        <svg class="fx-bolts" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bolts}</svg>
        <div class="fx-win-word">
          <div class="fx-win-main">${isTsumo ? "自摸" : "胡"}</div>
          <div class="fx-win-who">${name}${isTsumo ? " 自摸！" : " 胡牌！"}</div>
        </div>`;
    fxLayer().appendChild(ov);
    shakeTable("big");
    setTimeout(() => shakeTable("big"), 550);
    setTimeout(() => ov.classList.add("fx-out"), WIN_FX_MS - 350);
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
