// ══════════════════════════════════════════
// wordSystem.js — 拼字驗證（萬用牌展開、排列組合、2 字母白名單）
// ══════════════════════════════════════════
const TWO_LETTER_WORDS = new Set([
    "am","an","as","at","ax","be","by","do","go","he","hi","if","in",
    "is","it","me","my","no","of","oh","ok","on","or","ow","ox","so",
    "to","up","us","we"
]);

function getLettersFromZone() {
    return gameState.wordZone.map(t => t.letter);
}

// 產生所有排列（吃牌時使用）
function getPermutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        getPermutations(rest).forEach(perm => result.push([arr[i], ...perm]));
    }
    return result;
}

// 萬用牌 * 展開成 a~z 所有可能
function expandWildcards(letters) {
    let results = [];
    function helper(path, index) {
        if (index === letters.length) { results.push(path.join("")); return; }
        if (letters[index] === "*") {
            for (let c = 97; c <= 122; c++) helper([...path, String.fromCharCode(c)], index + 1);
        } else {
            helper([...path, letters[index]], index + 1);
        }
    }
    helper([], 0);
    return results;
}

// 拼字（自己按「確認拼字」）
function submitWord() {
    if (phase !== "turn" || currentSeat !== viewSeat) return;
    if (gameState.wordZone.length === 0) return;
    if (gameState.wordZone.length < 2) {
        setMessage("❌ 單字至少需要 2 個字母", true);
        return;
    }
    if (netRole === "client") { netClientAct({ a: "word", ids: gameState.wordZone.map(t => t.id) }); return; }

    const tiles = gameState.wordZone.slice();
    gameState.wordZone = [];   // 拼字區的牌已經從手牌拿出來了
    const r = applySpell(viewSeat, tiles);
    if (!r.ok) {
        gameState.wordZone = tiles;
        playSound('invalid');
        setMessage(r.msg, true);
        renderAll();
    }
}

// 用 tiles（已經從 seat 的手牌拿出來）拼字；3／4 張相同字母 = 自己碰／槓
// 回傳 { ok }；失敗時 { ok:false, msg }，牌由呼叫的人放回去
function applySpell(seat, tiles) {
    if (tiles.length < 2) return { ok: false, msg: "❌ 單字至少需要 2 個字母" };
    const letters = tiles.map(t => t.letter);

    const real = letters.filter(l => l !== "*");
    if ((letters.length === 3 || letters.length === 4) && real.length > 0 && real.every(l => l === real[0])) {
        if (letters.length === 3) doSelfPung(seat, real[0], true);
        else doSelfKongFromZone(seat, real[0]);
        return { ok: true };
    }

    let word = null;
    if (letters.length === 2) {
        word = expandWildcards(letters).find(w => TWO_LETTER_WORDS.has(w)) || null;
    } else {
        word = expandWildcards(letters).find(w => checkWordLocal(w)) || null;
    }
    if (!word) return { ok: false, msg: "❌ 不是有效單字：" + letters.join("").toLowerCase() };

    const p = seats[seat];
    p.words.push(word);
    playSound('success');
    showRootHint(word);
    showWordCard(word, `✅ ${p.name} 拼出`);
    setMessage(`✅ ${p.name} 拼出：${wordWithMeaning(word)}`);
    renderAll();
    if (checkWin(seat)) return { ok: true };
    finishTurnNoDiscard(seat);
    return { ok: true };
}

