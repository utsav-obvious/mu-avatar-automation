// Text rules for what is sent to ElevenLabs. Shared by set preparation (review-tool/cli/prepare-set.mjs)
// and the app's Edit mode (src/app/review/FixPanel.tsx), so both always behave the same.
//
// Why: in a sentence that contains Devanagari, eleven_multilingual_v2 tends to slip into Hindi for
// nearby English words and numbers. Set 3 reviewers fixed this by hand dozens of times — numbers
// written as English words, and "Hey" / "When you spoke with" written in Devanagari before a
// Devanagari name. These rules do the same automatically. Set 4 added: em dashes / ellipses → commas.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];

function below1000(n) {
    const parts = [];
    if (n >= 100) {
        parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
        n %= 100;
    }
    if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
    else if (n > 0 || !parts.length) parts.push(ONES[n]);
    return parts.join(" ");
}

/** 94 → "ninety-four", 1250 → "one thousand two hundred fifty". */
export function intToWords(n) {
    if (n === 0) return "zero";
    const parts = [];
    for (const [value, name] of SCALES) {
        if (n >= value) {
            parts.push(`${below1000(Math.floor(n / value))} ${name}`);
            n %= value;
        }
    }
    if (n > 0) parts.push(below1000(n));
    return parts.join(" ");
}

const IRREGULAR_ORDINALS = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

/** 10 → "tenth", 12 → "twelfth", 21 → "twenty-first". */
function ordinalWords(n) {
    const words = intToWords(n);
    const match = words.match(/([a-z]+)$/);
    const last = match[1];
    const ord = IRREGULAR_ORDINALS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
    return words.slice(0, -last.length) + ord;
}

/** "2024" → "twenty twenty-four", "2005" → "two thousand five". Only for 1900–2099. */
function yearWords(n) {
    if (n % 1000 < 10 && n >= 2000) return intToWords(n);
    const hi = Math.floor(n / 100), lo = n % 100;
    return `${intToWords(hi)} ${lo === 0 ? "hundred" : lo < 10 ? `oh ${ONES[lo]}` : intToWords(lo)}`;
}

/** "94.4" → "ninety-four point four", "9.486" → "nine point four eight six", "1,000" → "one thousand". */
function amountWords(raw, allowYear = false) {
    const clean = raw.replace(/,/g, "");
    const [whole, frac] = clean.split(".");
    const n = Number(whole);
    if (frac !== undefined) return `${intToWords(n)} point ${[...frac].map(d => ONES[Number(d)]).join(" ")}`;
    if (allowYear && /^\d{4}$/.test(whole) && n >= 1900 && n <= 2099) return yearWords(n);
    return intToWords(n);
}

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/** Every number in the text, written as English words. */
export function numbersToWords(text) {
    return text
        .replace(new RegExp(String.raw`₹\s?(${NUMBER})(\s+(?:lakh|crore|thousand|million|billion))?`, "g"),
            (_, a, unit = "") => `${amountWords(a)}${unit} rupees`)
        .replace(new RegExp(String.raw`\bRs\.?\s?(${NUMBER})`, "g"), (_, a) => `${amountWords(a)} rupees`)
        .replace(new RegExp(String.raw`(?<![\w.])(${NUMBER})\s?%`, "g"), (_, a) => `${amountWords(a)} percent`)
        .replace(/\bClass (\d+)(?:st|nd|rd|th)\b/g, "Class $1") // "Class 12th" → "Class twelve"
        .replace(new RegExp(String.raw`(?<![\w.])(${NUMBER})x(?![\w])`, "g"), (_, a) => `${amountWords(a)} times`)
        .replace(/(?<![\w.])(\d+)(?:st|nd|rd|th)\b/gi, (_, n) => ordinalWords(Number(n)))
        .replace(new RegExp(String.raw`(?<![\w.])(${NUMBER})\+`, "g"), (_, a) => `${amountWords(a)} plus`)
        .replace(new RegExp(String.raw`(?<![\w.])(${NUMBER})(?![\w])`, "g"), (_, a) => amountWords(a, true));
}

/**
 * Em dashes and ellipses make the voice pause for a second and drop its tone — Set 4 reviewers
 * re-rolled closing lines like "Welcome to the Masters' Union family — see you on campus soon!" again
 * and again. Send a comma instead (a full stop for a trailing ellipsis). Works on one sentence.
 */
export function softenPauses(text) {
    return text
        .replace(/\s*(?:…|\.{3})\s*$/, ".")
        .replace(/\s*(?:…|\.{3})\s*/g, ", ")
        .replace(/\s*—\s*/g, ", ")
        .replace(/,\s*([,.!?])/g, "$1");
}

const DEVANAGARI_NEXT = String.raw`(?=[ऀ-ॿ])`;

/** "Hey विधि" → "हे विधि", "When you spoke with गौरव" → "वेन यू स्पोक विद गौरव". */
export function devanagariLeadIns(text) {
    return text
        .replace(new RegExp(String.raw`\bHey ${DEVANAGARI_NEXT}`, "g"), "हे ")
        .replace(new RegExp(String.raw`\bWhen you spoke with ${DEVANAGARI_NEXT}`, "g"), "वेन यू स्पोक विद ");
}

// Placeholders for already-spelled names use private-use characters (never digits), so the number
// rule can't touch them.
const slotMarker = i => `\u0000${String.fromCharCode(0xe000 + i)}\u0001`;
const SLOT = /\u0000([-])\u0001/g;

/**
 * Library entries that start with a number ("94.4", "96.2 %") are reviewer workarounds for the
 * number rule; callers drop them with isNumberEntry() — numbers are handled here instead.
 *
 * Full text → what to send. `spellings` maps a term as written ("Vidhi") to its spoken form ("विधि");
 * longer terms win and a matched span can't be rewritten again by a shorter term.
 * Returns the spoken text and which rules/terms fired (for reporting).
 */
export function toSpoken(text, spellings) {
    const used = [];
    const slots = [];
    let out = text;
    const terms = [...spellings.keys()].sort((a, b) => b.length - a.length);
    for (const term of terms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, "gu"), () => {
            if (spellings.get(term) !== term) used.push(term);
            slots.push(spellings.get(term));
            return slotMarker(slots.length - 1);
        });
    }
    const withWords = numbersToWords(out);
    if (withWords !== out) used.push("numbers → words");
    out = withWords.replace(SLOT, (_, c) => numbersToWords(slots[c.charCodeAt(0) - 0xe000]));
    const withLeadIns = devanagariLeadIns(out);
    if (withLeadIns !== out) used.push("Devanagari lead-in");
    const softened = softenPauses(withLeadIns);
    if (softened !== withLeadIns) used.push("dash/ellipsis → comma");
    return { spoken: softened, used };
}

/** Reviewer-saved library entries like "94.4" or "87 % and 86 %" — superseded by numbersToWords(). */
export const isNumberEntry = term => /^\d/.test(term.trim());
