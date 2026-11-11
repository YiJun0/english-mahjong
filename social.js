// ══════════════════════════════════════════
// social.js — 互動道具（丟雞蛋／玫瑰／炸彈）與快捷聊天
// 只有真人會丟、會聊天；AI 不丟道具、不回話
// 點對手頭像 → 選道具 → 從自己的頭像拋過去，命中後爆開，
// 殘留在頭像上 0.4 秒後淡出
// ══════════════════════════════════════════

const PROPS = {
    egg:  { icon: "🥚", name: "雞蛋" },
    rose: { icon: "🌹", name: "玫瑰" },
    bomb: { icon: "💣", name: "炸彈" },
};

const TAUNTS = [
    "你要想多久？再等就過年了啦！",
    "謝謝餵牌，這張我等好久了～",
    "單字量就這樣嗎？回去背單字啦！",
    "快一點好嗎，我花都謝了！",
    "不好意思，這局我要胡了喔～",
];

const PROP_COOLDOWN_MS = 1500;
const CHAT_COOLDOWN_MS = 2500;
const HIT_LINGER_MS = 400;     // 爆開後殘留在頭像上的時間
const HIT_FADE_MS = 200;
let lastPropAt = 0;
let lastChatAt = 0;

// ── 找頭像位置 ──
function avatarEl(seat) {
    return document.querySelector(`.avatar[data-seat="${seat}"]`);
}
function avatarCenter(seat) {
    const el = avatarEl(seat);
    if (el) {
        const r = el.getBoundingClientRect();
        if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    }
    return { ...seatAnchor(seat), r: 20 };
}

// ── 小選單（道具、聊天共用） ──
function closePopMenu() {
    const m = document.getElementById("pop-menu");
    if (m) m.remove();
}

function openPopMenu(anchorEl, title, items, className) {
    closePopMenu();
    const menu = document.createElement("div");
    menu.id = "pop-menu";
    menu.className = "pop-menu " + (className || "");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="pop-title">${title}</div>`;
    items.forEach(it => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pop-item";
        b.setAttribute("role", "menuitem");
        b.innerHTML = it.html;
        b.onclick = (e) => { e.stopPropagation(); closePopMenu(); it.action(); };
        menu.appendChild(b);
    });
    document.body.appendChild(menu);

    const r = anchorEl.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.left + r.width / 2 - mw / 2;
    let top = r.bottom + 8;
    if (top + mh > innerHeight - 8) top = r.top - mh - 8;
    left = Math.max(8, Math.min(innerWidth - mw - 8, left));
    top = Math.max(8, top);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    const first = menu.querySelector(".pop-item");
    if (first) first.focus({ preventScroll: true });
}

document.addEventListener("pointerdown", (e) => {
    const m = document.getElementById("pop-menu");
    if (m && !m.contains(e.target) && !e.target.closest(".avatar-target, .chat-btn")) closePopMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopMenu(); });

function openPropMenu(targetSeat, anchorEl) {
    if (!seats[viewSeat] || seats[viewSeat].type !== "human") return;
    const name = seats[targetSeat] ? seats[targetSeat].name : "";
    openPopMenu(anchorEl, `丟給 ${name}`,
        Object.entries(PROPS).map(([key, p]) => ({
            html: `<span class="pop-icon">${p.icon}</span>${p.name}`,
            action: () => throwProp(viewSeat, targetSeat, key),
        })), "prop-menu");
}

function openChatMenu(anchorEl) {
    openPopMenu(anchorEl, "快捷聊天",
        TAUNTS.map((t, i) => ({ html: t, action: () => sendChat(viewSeat, i) })), "chat-menu");
}

// ══════════════════════════════════════════
// 粒子：給初速度＋重力，用 Web Animations 算出拋物線
// ══════════════════════════════════════════
function rand(a, b) { return a + Math.random() * (b - a); }

function particle(parent, el, { vx, vy, g = 900, dur = 700, spin = 0, scale0 = 1, scale1 = 1, fade = true, fadeIn = false, delay = 0 }) {
    parent.appendChild(el);
    if (!el.animate) return;
    const N = 12, frames = [];
    for (let i = 0; i <= N; i++) {
        const t = (i / N) * dur / 1000;
        const x = vx * t, y = vy * t + 0.5 * g * t * t;
        const k = i / N;
        frames.push({
            transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * k).toFixed(0)}deg) scale(${(scale0 + (scale1 - scale0) * k).toFixed(2)})`,
            opacity: (fadeIn && k < 0.25 ? k / 0.25 : 1) * (fade ? (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4) : 1),
        });
    }
    el.animate(frames, { duration: dur, delay, easing: "linear", fill: "both" });
}

// 平滑、不規則的液體形狀（SVG path）：半徑用幾個低頻波疊加，再用曲線連起來
function blobPath(R, wobble, n = 18) {
    const ph = [rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)];
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n;
        const k = 1 + wobble * (0.5 * Math.sin(3 * a + ph[0]) + 0.3 * Math.sin(5 * a + ph[1]) + 0.2 * Math.sin(7 * a + ph[2]));
        pts.push([Math.cos(a) * R * k, Math.sin(a) * R * k]);
    }
    // Catmull-Rom → 貝茲曲線，讓邊緣圓滑
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d + " Z";
}

// 尖細的液痕（從中心往外甩，前細後粗，末端一顆液滴）
function streakSVG(angle, r0, len, w, fill) {
    const L = len, bend = rand(-0.35, 0.35) * w;
    let out = `<g transform="rotate(${angle.toFixed(0)}) translate(${r0.toFixed(1)},0)">
      <path d="M0,${(-w).toFixed(1)} Q${(L * 0.5).toFixed(1)},${(-w * 0.5 + bend).toFixed(1)} ${L.toFixed(1)},${bend.toFixed(1)} Q${(L * 0.5).toFixed(1)},${(w * 0.5 + bend).toFixed(1)} 0,${w.toFixed(1)} Z" fill="${fill}"/>`;
    // 有的液痕末端甩出一兩顆液滴，大小、距離都不固定
    if (Math.random() < 0.6) {
        const k = 1 + Math.floor(rand(0, 2.2));
        for (let j = 0; j < k; j++) {
            out += `<circle cx="${(L + w * rand(0.6, 2.5) + j * w * 1.6).toFixed(1)}" cy="${(bend + rand(-w, w) * 0.5).toFixed(1)}" r="${(w * rand(0.35, 0.8)).toFixed(1)}" fill="${fill}"/>`;
        }
    }
    return out + "</g>";
}

// ══════════════════════════════════════════
// 丟道具
// ══════════════════════════════════════════
function throwProp(from, to, type) {
    if (!seats[from] || !seats[to] || from === to) return;
    if (seats[from].type !== "human") return;            // AI 不丟道具
    const now = Date.now();
    if (now - lastPropAt < PROP_COOLDOWN_MS) return;
    lastPropAt = now;
    if (netRole) netSendProp(from, to, type);             // 線上對戰：同步給其他人
    playProp(from, to, type);
}

// 播放丟道具的動畫（自己丟的、或收到別人丟的都用這個）
function playProp(from, to, type) {
    if (!seats[from] || !seats[to] || !PROPS[type]) return;

    const a = avatarCenter(from), b = avatarCenter(to);
    const fly = document.createElement("div");
    fly.className = "prop-fly fly-" + type;
    fly.innerHTML = type === "egg" ? `<div class="egg-body"></div>` : PROPS[type].icon;
    fxLayer().appendChild(fly);
    playSound("whoosh");

    const done = () => { fly.remove(); propImpact(to, type, b); };
    if (reducedMotion() || !fly.animate) { setTimeout(done, 150); return; }

    const dx = b.x - a.x, dy = b.y - a.y;
    const arc = Math.min(220, 80 + Math.hypot(dx, dy) * 0.35);
    const spin = type === "rose" ? 160 : type === "egg" ? 720 : 420;
    const frames = [];
    const N = 20;
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = a.x + dx * t;
        const y = a.y + dy * t - arc * 4 * t * (1 - t);
        const s = 0.75 + 0.45 * Math.sin(Math.PI * t);
        frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${spin * t}deg) scale(${s})` });
    }
    const anim = fly.animate(frames, { duration: 720, easing: "cubic-bezier(.35,.1,.6,1)", fill: "forwards" });

    // 炸彈：飛行時引信一路噴火花
    if (type === "bomb") {
        const sparkTimer = setInterval(() => {
            const r = fly.getBoundingClientRect();
            if (!r.width) return;
            const s = document.createElement("i");
            s.className = "fuse-spark";
            const holder = document.createElement("div");
            holder.className = "fx-abs";
            holder.style.left = (r.left + r.width * 0.75) + "px";
            holder.style.top = (r.top + r.height * 0.15) + "px";
            fxLayer().appendChild(holder);
            particle(holder, s, { vx: rand(-60, 60), vy: rand(-80, 0), g: 300, dur: 350 });
            setTimeout(() => holder.remove(), 400);
        }, 40);
        anim.onfinish = () => { clearInterval(sparkTimer); done(); };
    } else {
        anim.onfinish = done;
    }
}

// 命中：先爆開，殘留 0.4 秒，再淡出
function propImpact(seat, type, pos) {
    const R = Math.max(18, pos.r);
    const box = document.createElement("div");
    box.className = "prop-hit hit-" + type;
    box.style.left = pos.x + "px";
    box.style.top = pos.y + "px";
    fxLayer().appendChild(box);

    let burstMs;
    if (type === "egg") burstMs = eggImpact(box, R);
    else if (type === "rose") burstMs = roseImpact(box, R);
    else burstMs = bombImpact(box, R, seat);

    setTimeout(() => box.classList.add("hit-out"), burstMs + HIT_LINGER_MS);
    setTimeout(() => box.remove(), burstMs + HIT_LINGER_MS + HIT_FADE_MS + 50);
}

// 雞蛋：蛋殼碎裂噴飛、蛋黃蛋白往外噴濺，頭像上留下濕濕的噴濺痕
function eggImpact(box, R) {
    playSound("splat");
    R = R * 1.4;   // 蛋液噴得比頭像大一點
    const view = R * 3.8;
    const white = "rgba(246,240,214,0.82)";
    let svg = `<path d="${blobPath(R * 0.8, 0.55, 14)}" fill="${white}"/>`;
    // 蛋白：亂噴出去的液痕（角度、長短、粗細都隨機，不會排成星星）
    const n = 7 + Math.floor(rand(0, 4));
    for (let i = 0; i < n; i++) {
        svg += streakSVG(rand(0, 360), R * rand(0.35, 0.7), R * rand(0.3, 1.4), R * rand(0.07, 0.2), white);
    }
    // 散落的小液滴
    for (let i = 0; i < 9; i++) {
        const a = rand(0, Math.PI * 2), d = R * rand(1.0, 2.3);
        svg += `<path d="${blobPath(R * rand(0.04, 0.11), 0.4, 8)}" fill="${white}" transform="translate(${(Math.cos(a) * d).toFixed(1)},${(Math.sin(a) * d).toFixed(1)})"/>`;
    }
    // 蛋黃：被打散，只剩不規則的一小坨＋幾道黃色液痕（不是完整的圓）
    const yx = R * rand(-0.2, 0.2), yy = R * rand(-0.15, 0.2);
    let yolk = `<path d="${blobPath(R * 0.28, 0.65, 12)}" fill="url(#eggYolk)"/>`;
    for (let i = 0; i < 4; i++) {
        yolk += streakSVG(rand(0, 360), R * 0.12, R * rand(0.3, 1.0), R * rand(0.06, 0.13), "#ffa000");
    }
    // 黏在上面的幾片蛋殼
    let shells = "";
    for (let i = 0; i < 3; i++) {
        const sx = R * rand(-0.9, 0.9), sy = R * rand(-0.9, 0.9), sz = R * rand(0.18, 0.3);
        shells += `<path d="M${(-sz).toFixed(1)},${(sz * 0.4).toFixed(1)} L${(-sz * 0.3).toFixed(1)},${(-sz).toFixed(1)} L${(sz * 0.2).toFixed(1)},${(-sz * 0.2).toFixed(1)} L${sz.toFixed(1)},${(-sz * 0.7).toFixed(1)} L${(sz * 0.7).toFixed(1)},${(sz * 0.8).toFixed(1)} Z"
                   fill="#fbf3e0" stroke="#c9b48a" stroke-width="1" transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) rotate(${rand(0, 360).toFixed(0)})"/>`;
    }
    box.insertAdjacentHTML("beforeend", `
      <div class="egg-pop"></div>
      <svg class="egg-splat" width="${view * 2}" height="${view * 2}" viewBox="${-view} ${-view} ${view * 2} ${view * 2}"
           style="left:${-view}px;top:${-view}px">
        <defs>
          <radialGradient id="eggYolk" cx="38%" cy="32%" r="75%">
            <stop offset="0" stop-color="#ffe27a"/>
            <stop offset="0.5" stop-color="#ffab00"/>
            <stop offset="1" stop-color="#e06a00"/>
          </radialGradient>
        </defs>
        <g transform="rotate(${rand(0, 360).toFixed(0)})">${svg}</g>
        <g transform="translate(${yx.toFixed(1)},${yy.toFixed(1)})">${yolk}</g>
        ${shells}
      </svg>`);
    // 往下流的蛋汁
    for (let i = 0; i < 3; i++) {
        const d = document.createElement("i");
        d.className = "egg-drip";
        d.style.left = (rand(-0.7, 0.6) * R).toFixed(0) + "px";
        d.style.top = (R * rand(0.2, 0.5)).toFixed(0) + "px";
        d.style.animationDelay = (0.15 + i * 0.08).toFixed(2) + "s";
        box.appendChild(d);
    }
    // 蛋殼碎片
    for (let i = 0; i < 18; i++) {
        const s = document.createElement("i");
        s.className = "egg-shard";
        const w = rand(6, 14), h = rand(5, 11);
        s.style.width = w + "px"; s.style.height = h + "px";
        s.style.clipPath = `polygon(${rand(0, 30)}% ${rand(0, 30)}%, ${rand(60, 100)}% ${rand(0, 25)}%, ${rand(70, 100)}% ${rand(60, 100)}%, ${rand(0, 40)}% ${rand(70, 100)}%)`;
        const ang = rand(-Math.PI, 0) + rand(-0.4, 0.4);   // 主要往上、往兩側噴
        const sp = rand(160, 340);
        particle(box, s, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 1100, dur: rand(550, 750), spin: rand(-720, 720) });
    }
    // 蛋黃、蛋白的飛濺液滴
    for (let i = 0; i < 28; i++) {
        const d = document.createElement("i");
        const yolk = Math.random() < 0.45;
        d.className = "egg-drop " + (yolk ? "yolk" : "white");
        const sz = rand(3, yolk ? 10 : 8);
        d.style.width = sz + "px"; d.style.height = sz + "px";
        const ang = rand(0, Math.PI * 2);
        const sp = rand(120, 300);
        particle(box, d, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 60, g: 900, dur: rand(400, 600), scale0: 1, scale1: 0.6 });
    }
    return 600;
}

// 玫瑰：玫瑰落在頭像上，花瓣散開後飄落，帶一點閃光
function roseImpact(box, R) {
    playSound("sparkle");
    const rose = document.createElement("div");
    rose.className = "rose-land";
    rose.textContent = "🌹";
    box.appendChild(rose);
    for (let i = 0; i < 14; i++) {
        const p = document.createElement("i");
        p.className = "rose-petal";
        p.style.width = rand(11, 16).toFixed(0) + "px";
        p.style.height = rand(14, 20).toFixed(0) + "px";
        p.style.setProperty("--tone", Math.random() < 0.5 ? "#c2185b" : "#e53950");
        const ang = rand(0, Math.PI * 2);
        const sp = rand(80, 170);
        particle(box, p, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 90, g: 380, dur: rand(700, 950), spin: rand(-540, 540), scale0: 1.1, scale1: 0.8 });
    }
    for (let i = 0; i < 8; i++) {
        const g = document.createElement("i");
        g.className = "rose-glint";
        g.style.left = rand(-R * 1.3, R * 1.3).toFixed(0) + "px";
        g.style.top = rand(-R * 1.3, R * 1.1).toFixed(0) + "px";
        g.style.animationDelay = rand(0, 0.4).toFixed(2) + "s";
        box.appendChild(g);
    }
    return 800;
}

// 炸彈：白光＋衝擊波＋好幾團火球＋火星亂噴＋濃煙，頭像被燻黑
function bombImpact(box, R, seat) {
    playSound("boom");
    box.insertAdjacentHTML("beforeend", `<div class="boom-flash"></div><div class="boom-wave"></div><div class="boom-soot" style="--r:${R}px"></div>`);
    for (let i = 0; i < 6; i++) {
        const f = document.createElement("div");
        f.className = "boom-ball";
        const s = rand(50, 95);
        f.style.width = f.style.height = s + "px";
        f.style.left = (rand(-R * 0.8, R * 0.8) - s / 2).toFixed(0) + "px";
        f.style.top = (rand(-R * 0.9, R * 0.5) - s / 2).toFixed(0) + "px";
        f.style.animationDelay = (i * 0.04).toFixed(2) + "s";
        box.appendChild(f);
    }
    for (let i = 0; i < 22; i++) {
        const e = document.createElement("i");
        e.className = "boom-ember";
        const ang = rand(0, Math.PI * 2);
        const sp = rand(200, 420);
        particle(box, e, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80, g: 700, dur: rand(450, 700), scale1: 0.3 });
    }
    for (let i = 0; i < 9; i++) {
        const s = document.createElement("i");
        s.className = "boom-smoke";
        const ang = rand(-Math.PI, 0);
        const sp = rand(40, 110);
        particle(box, s, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40, g: -60, dur: rand(800, 1000), scale0: 0.5, scale1: 2.2, fadeIn: true, delay: rand(60, 160) });
    }
    const el = avatarEl(seat);
    const wrap = el && el.closest(".seat-panel, .player-bottom-bar");
    if (wrap && !reducedMotion()) {
        wrap.classList.remove("prop-shake"); void wrap.offsetWidth; wrap.classList.add("prop-shake");
        setTimeout(() => wrap.classList.remove("prop-shake"), 500);
    }
    return 800;
}

// ══════════════════════════════════════════
// 快捷聊天（只有真人）
// ══════════════════════════════════════════
function sendChat(seat, idx) {
    if (!seats[seat] || seats[seat].type !== "human") return;
    if (!TAUNTS[idx]) return;
    const now = Date.now();
    if (now - lastChatAt < CHAT_COOLDOWN_MS) return;
    lastChatAt = now;
    if (netRole) netSendChat(seat, idx);
    showChat(seat, idx);
}

// 顯示對話框＋唸出來（自己說的、或收到別人說的都用這個）
function showChat(seat, idx) {
    const text = TAUNTS[idx];
    if (!seats[seat] || !text) return;
    document.querySelectorAll(`.chat-bubble[data-seat="${seat}"]`).forEach(b => b.remove());

    const pos = avatarCenter(seat);
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.dataset.seat = seat;
    bubble.textContent = text;
    fxLayer().appendChild(bubble);

    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let top = pos.y - pos.r - bh - 12;
    if (top < 8) { top = pos.y + pos.r + 12; bubble.classList.add("below"); }
    const left = Math.max(8, Math.min(innerWidth - bw - 8, pos.x - bw / 2));
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
    bubble.style.setProperty("--tail", (pos.x - left) + "px");

    playSound("pop");
    fxVoice("taunt" + (idx + 1), text);
    setTimeout(() => bubble.classList.add("hide"), 3000);
    setTimeout(() => bubble.remove(), 3400);
}
