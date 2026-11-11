// ══════════════════════════════════════════
// wheel.js — 懲罰轉盤（有 2 位以上真人時才出現）
// 整場打完才有：總分最高的人拉桿、最低的人受罰，也可以選擇跳過
// 拉桿力道決定轉幾圈，但停在哪一格每次都加上隨機，小力也猜不到結果
// ══════════════════════════════════════════
const PENALTIES = [
    "蛙跳 10 下", "開合跳 10 下", "深蹲 10 下", "真心話", "平板支撐 15 秒",
    "大聲學狗叫 3 聲", "模仿指定動物 15 秒", "走台步 15 秒", "蹲馬步 15 秒", "大冒險",
    "英文自我介紹 30 秒", "念繞口令 2 次", "學企鵝跑 15 秒", "唱學貓叫 15 秒", "醜照 3 連拍"
];
const PENALTY_NOTE = {
    "真心話": "誠實回答大家問的一個問題",
    "大冒險": "完成大家指定的一件事",
    "模仿指定動物 15 秒": "由拉桿的人指定要模仿哪種動物",
    "念繞口令 2 次": "She sells seashells by the seashore.",
    "醜照 3 連拍": "由大家幫你拍 3 張醜照",
};
const SPECIAL = new Set(["真心話", "大冒險"]);
const SEG_COLORS = ["#2e7d32", "#1565c0", "#6a1b9a", "#00838f", "#ef6c00"];
const SEG = (Math.PI * 2) / PENALTIES.length;

const MIN_PULL = 0.25;      // 拉不到 25% 會彈回去

var wheel = {
    angle: 0, spinning: false, pull: 0, dragging: false, dragStartY: 0,
    spinner: null, target: null, resultIndex: -1, lastTickIndex: -1,
};

// ── 決定誰拉桿、誰受罰：整場總分最高的人拉桿、最低的人受罰 ──
function penaltyPair() {
    const ranked = [...seats].sort((a, b) => b.score - a.score);
    return { spinner: ranked[0], target: ranked[ranked.length - 1], note: "" };
}

// 雙人對戰、4 人模式才有轉盤（對戰 AI 沒有）
function canUseWheel() {
    return gameMode !== "ai";
}

// 線上對戰：只有拉桿的人能拉（其他人看同一個轉盤一起轉）
function canPullLever() {
    return !netRole || (wheel.spinner && wheel.spinner.id === viewSeat);
}

function openWheel(fromNet = false) {
    if (netRole && !fromNet) netSendWheelOpen();
    const pair = penaltyPair();
    if (netRole) wheel.angle = 0;   // 大家從同一個角度開始，轉出來的結果才一樣
    wheel.spinner = pair.spinner;
    wheel.target = pair.target;
    wheel.resultIndex = -1;
    wheel.spinning = false;
    wheel.pull = 0;

    document.getElementById("wheel-who").innerHTML =
        `<span class="ww-role">拉桿</span><b>${pair.spinner.name}</b>` +
        `<span class="ww-arrow">→</span>` +
        `<span class="ww-role">受罰</span><b class="ww-target">${pair.target.name}</b>`;
    const note = document.getElementById("wheel-note");
    note.innerText = pair.note;
    note.hidden = !pair.note;
    document.getElementById("wheel-result").hidden = true;
    document.getElementById("wheel-hint").innerText = canPullLever()
        ? `${pair.spinner.name}：按住拉桿往下拉，放開就轉！`
        : `等 ${pair.spinner.name} 拉桿…`;
    document.getElementById("lever-track").classList.toggle("lever-locked", !canPullLever());
    document.getElementById("wheel-skip").hidden = false;
    document.getElementById("wheel-done").hidden = true;
    setLever(0);
    document.getElementById("wheel-overlay").classList.add("visible");
    sizeWheelCanvas();
    drawWheel();
}

function closeWheel() {
    wheel.spinning = false;
    document.getElementById("wheel-overlay").classList.remove("visible");
}

// ── 畫轉盤 ──
function sizeWheelCanvas() {
    const c = document.getElementById("wheel-canvas");
    const css = c.getBoundingClientRect().width || 300;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(css * dpr);
    c.height = Math.round(css * dpr);
}

function drawWheel() {
    const c = document.getElementById("wheel-canvas");
    const ctx = c.getContext("2d");
    const W = c.width, R = W / 2, r = R - W * 0.03;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(R, R);

    // 外框＋燈泡
    ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#5d4037"; ctx.fill();
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + (wheel.spinning ? wheel.angle * 0.5 : 0);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (R - W * 0.015), Math.sin(a) * (R - W * 0.015), W * 0.007, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? "#fff59d" : "#ffca28"; ctx.fill();
    }

    for (let i = 0; i < PENALTIES.length; i++) {
        const a0 = wheel.angle + i * SEG, a1 = a0 + SEG;
        const label = PENALTIES[i];
        const win = i === wheel.resultIndex;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a0, a1); ctx.closePath();
        ctx.fillStyle = label === "真心話" ? "#c62828" : label === "大冒險" ? "#ad1457"
                                           : SEG_COLORS[i % SEG_COLORS.length];
        ctx.fill();
        if (win) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill(); }
        ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = W * 0.003; ctx.stroke();

        // 文字沿半徑方向
        ctx.save();
        ctx.rotate(a0 + SEG / 2);
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        const fs = Math.max(9, W * (label.length > 8 ? 0.028 : 0.034));
        ctx.font = `bold ${fs}px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.fillText(label, r - W * 0.025, 0);
        ctx.restore();
    }

    // 中心
    ctx.beginPath(); ctx.arc(0, 0, W * 0.085, 0, Math.PI * 2);
    ctx.fillStyle = "#fffde7"; ctx.fill();
    ctx.lineWidth = W * 0.008; ctx.strokeStyle = "#fdd835"; ctx.stroke();
    ctx.fillStyle = "#c62828";
    ctx.font = `bold ${W * 0.06}px "Microsoft JhengHei","PingFang TC",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("罰", 0, W * 0.004);
    ctx.restore();
}

// 指針（正上方）指到哪一格
function indexAtPointer(angle) {
    const phi = ((1.5 * Math.PI - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(phi / SEG) % PENALTIES.length;
}

// ── 拉桿 ──
function setLever(p) {
    wheel.pull = p;
    const track = document.getElementById("lever-track");
    const knob = document.getElementById("lever-knob");
    const travel = track.clientHeight - knob.offsetHeight;
    knob.style.transform = `translateY(${p * travel}px)`;
    document.getElementById("lever-stick").style.height = `${p * travel + knob.offsetHeight / 2}px`;
    document.getElementById("power-fill").style.height = `${p * 100}%`;
    document.getElementById("power-label").innerText = p > 0 ? `${Math.round(p * 100)}%` : "力道";
}

function leverDown(e) {
    if (wheel.spinning || wheel.resultIndex !== -1 || !canPullLever()) return;
    wheel.dragging = true;
    wheel.dragStartY = e.clientY - wheel.pull * leverTravel();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
}

function leverMove(e) {
    if (!wheel.dragging) return;
    const p = Math.max(0, Math.min(1, (e.clientY - wheel.dragStartY) / leverTravel()));
    setLever(p);
    const hint = document.getElementById("wheel-hint");
    hint.innerText = p < MIN_PULL ? "再拉下去一點…" : p > 0.85 ? "超大力！放開！" : "放開就轉！";
}

function leverUp() {
    if (!wheel.dragging) return;
    wheel.dragging = false;
    releaseLever();
}

function leverTravel() {
    const track = document.getElementById("lever-track");
    const knob = document.getElementById("lever-knob");
    return Math.max(1, track.clientHeight - knob.offsetHeight);
}

// 鍵盤：↓ 加力道，Enter／空白鍵放開
function leverKey(e) {
    if (wheel.spinning || wheel.resultIndex !== -1 || !canPullLever()) return;
    if (e.key === "ArrowDown") { setLever(Math.min(1, wheel.pull + 0.1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setLever(Math.max(0, wheel.pull - 0.1)); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === " ") { releaseLever(); e.preventDefault(); }
}

function releaseLever() {
    const p = wheel.pull;
    if (p < MIN_PULL) {
        document.getElementById("wheel-hint").innerText = "力道不夠，拉桿彈回去了！再用力一點";
        springBack(p);
        if (p > 0.03) playSound('invalid');
        return;
    }
    springBack(p);
    const r = [Math.random(), Math.random(), Math.random()];
    if (netRole) netSendWheelSpin(p, r);
    spinWheel(p, r);
}

function springBack(from) {
    const start = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - start) / 250);
        setLever(from * (1 - t) * (1 - t));
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// ── 轉動 ──
// 力道 → 圈數與時間；最後停的位置另外加上隨機，所以結果無法用力道控制
// r：三個 0～1 的亂數（線上對戰由拉桿的人產生，大家用同一組，轉出來一樣）
function spinWheel(power, r = [Math.random(), Math.random(), Math.random()]) {
    if (wheel.spinning) return;
    wheel.spinning = true;
    document.getElementById("wheel-skip").hidden = true;
    document.getElementById("wheel-hint").innerText = power > 0.85 ? "🔥 超大力！" : power > 0.55 ? "轉起來了！" : "慢慢轉…";

    const turns = 2 + power * 5 + r[0] * 1.5;
    const randomStop = r[1] * Math.PI * 2;
    const start = wheel.angle;
    const end = start + turns * Math.PI * 2 + randomStop;
    const duration = 3500 + power * 3500 + r[2] * 600;
    const t0 = performance.now();
    wheel.lastTickIndex = indexAtPointer(start);

    const frame = (now) => {
        if (!wheel.spinning) return;
        const t = Math.min(1, (now - t0) / duration);
        const ease = 1 - Math.pow(1 - t, 4);        // 越轉越慢，最後幾格最刺激
        wheel.angle = start + (end - start) * ease;
        const idx = indexAtPointer(wheel.angle);
        if (idx !== wheel.lastTickIndex) {
            wheel.lastTickIndex = idx;
            playSound('clack');
            const pointer = document.getElementById("wheel-pointer");
            pointer.classList.remove("flap"); void pointer.offsetWidth; pointer.classList.add("flap");
        }
        drawWheel();
        if (t < 1) requestAnimationFrame(frame);
        else finishSpin();
    };
    requestAnimationFrame(frame);
}

function finishSpin() {
    wheel.spinning = false;
    wheel.angle %= Math.PI * 2;
    wheel.resultIndex = indexAtPointer(wheel.angle);
    drawWheel();
    playSound('fanfare');

    const penalty = PENALTIES[wheel.resultIndex];
    document.getElementById("wheel-hint").innerText = "";
    document.getElementById("wr-target").innerText = `${wheel.target.name} 要做`;
    document.getElementById("wr-penalty").innerText = penalty;
    const note = PENALTY_NOTE[penalty] || "";
    const noteEl = document.getElementById("wr-note");
    noteEl.innerText = penalty === "模仿指定動物 15 秒" ? `由 ${wheel.spinner.name} 指定要模仿哪種動物` : note;
    noteEl.hidden = !noteEl.innerText;
    document.getElementById("wheel-result").hidden = false;
    document.getElementById("wheel-done").hidden = false;
}

function initWheel() {
    const lever = document.getElementById("lever-track");
    lever.addEventListener("pointerdown", leverDown);
    lever.addEventListener("pointermove", leverMove);
    lever.addEventListener("pointerup", leverUp);
    lever.addEventListener("pointercancel", leverUp);
    lever.addEventListener("keydown", leverKey);
    window.addEventListener("resize", () => {
        if (document.getElementById("wheel-overlay").classList.contains("visible")) { sizeWheelCanvas(); drawWheel(); }
    });
}
