// ══════════════════════════════════════════
// deck.js — 建立牌組與洗牌
// 共 108 張：104 張字母牌（依英文使用頻率加權）+ 4 張萬用牌
// ══════════════════════════════════════════
let allLetters = [];

function buildDeck() {
    allLetters = [];

    function add(letter, count) {
        for (let i = 0; i < count; i++) {
            allLetters.push({
                id: crypto.randomUUID(),
                letter: letter
            });
        }
    }

    // 🟢 加權英文牌組
    add("a", 6);
    add("b", 2);
    add("c", 4);
    add("d", 4);
    add("e", 8);
    add("f", 4);
    add("g", 4);
    add("h", 4);
    add("i", 8);
    add("j", 2);
    add("k", 2);
    add("l", 4);
    add("m", 4);
    add("n", 6);
    add("o", 8);
    add("p", 2);
    add("q", 2);
    add("r", 4);
    add("s", 4);
    add("t", 8);
    add("u", 4);
    add("v", 2);
    add("w", 2);
    add("x", 2);
    add("y", 2);
    add("z", 2);

    // 🟡 萬用牌
    add("*", 4);
}

// Fisher-Yates 洗牌
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
