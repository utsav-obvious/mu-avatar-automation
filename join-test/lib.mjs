import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadScripts, loadEnv } from "../v4-test/lib.mjs";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_ID = "MUSB-C8-71478";
export const MODEL = "eleven_multilingual_v2";
export const SEED = 42;
const GAP_SENTENCE = 0.45; // seconds of silence between sentences in a paragraph
const GAP_PARAGRAPH = 0.8; // seconds between paragraphs

const env = loadEnv();
const API_KEY = env.ELEVEN_LABS_API_KEY;
const VOICE_ID = env.ELEVEN_LABS_VOICE_ID;
if (!API_KEY || !VOICE_ID) { console.error("Missing ELEVEN_LABS_API_KEY / ELEVEN_LABS_VOICE_ID"); process.exit(1); }

let format = "pcm_44100";
export const getFormat = () => format;
export const sampleRate = () => Number(format.split("_")[1]);

// Production-style text (Indian nouns in Devanagari), split into sentences tagged with their paragraph.
export function loadSentences() {
    const text = loadScripts().find(s => s.id === SCRIPT_ID).texts.rewritten;
    const sentences = text.split(/\n+/).map(p => p.trim()).filter(Boolean)
        .flatMap((p, paragraph) => p.split(/(?<=[.!?])\s+/).map(s => ({ text: s.trim(), paragraph })))
        .filter(s => s.text);
    return { text, sentences };
}

export async function tts(text, extra = {}) {
    const body = { text, model_id: MODEL, seed: SEED, voice_settings: { stability: 0.5, similarity_boost: 0.75 }, ...extra };
    const call = () => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${format}`, {
        method: "POST",
        headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    let res = await call();
    if (!res.ok && format === "pcm_44100") {
        const err = await res.text();
        if (/format|tier|subscription/i.test(err)) {
            console.warn(`   pcm_44100 not available on this plan → using pcm_24000 (${err.slice(0, 120)})`);
            format = "pcm_24000";
            res = await call();
        } else throw Object.assign(new Error(`${res.status}: ${err}`), { status: res.status });
    }
    if (!res.ok) throw Object.assign(new Error(`${res.status}: ${await res.text()}`), { status: res.status });
    const pcm = new Int16Array(await res.arrayBuffer());
    return { pcm, requestId: res.headers.get("request-id"), headers: res.headers };
}

// Trim leading/trailing near-silence (keeps a 30ms margin) so every version gets identical, controlled gaps.
export function trim(pcm) {
    const threshold = 400, margin = Math.round(0.03 * sampleRate());
    let a = 0, b = pcm.length - 1;
    while (a < b && Math.abs(pcm[a]) < threshold) a++;
    while (b > a && Math.abs(pcm[b]) < threshold) b--;
    return pcm.subarray(Math.max(0, a - margin), Math.min(pcm.length, b + margin));
}

const gapBefore = (sentences, i) => (sentences[i].paragraph !== sentences[i - 1].paragraph ? GAP_PARAGRAPH : GAP_SENTENCE);

export function join(clips, sentences) {
    const parts = [];
    clips.forEach((pcm, i) => {
        if (i > 0) parts.push(new Int16Array(Math.round(gapBefore(sentences, i) * sampleRate())));
        parts.push(trim(pcm));
    });
    const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

// Start time (seconds) of clip `idx` inside a joined version.
export function startOf(clips, sentences, idx) {
    let t = 0;
    for (let i = 0; i < idx; i++) t += trim(clips[i]).length / sampleRate() + gapBefore(sentences, i + 1);
    return t;
}

export function wav(pcm) {
    const sr = sampleRate(), data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
}

// Writes shuffled A/B/C… files plus a blind listening page with a reveal button.
export function writeBlindPage(outDir, title, intro, questions, entries) {
    fs.mkdirSync(outDir, { recursive: true });
    const letters = "ABCDEFGH".split("");
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const key = {};
    shuffled.forEach((e, i) => {
        const file = `${letters[i]}.wav`;
        if (e.pcm) fs.writeFileSync(path.join(outDir, file), wav(e.pcm));
        else fs.copyFileSync(e.copyFrom, path.join(outDir, file));
        key[letters[i]] = { version: e.version, about: e.about };
    });
    const cards = Object.entries(key).map(([l, k]) => `<div class="card"><h2>${l}</h2><audio controls preload="auto" src="${l}.wav"></audio>
<div class="reveal"><b>${k.version}</b> — ${k.about}</div></div>`).join("");
    fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
  :root { --bg:#f6f7f9; --panel:#fff; --text:#16181d; --muted:#6b7280; --line:#e5e7eb; --accent:#4f46e5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --panel:#181b21; --text:#e6e8eb; --muted:#9aa1ac; --line:#2a2f38; --accent:#a5b4fc; } }
  body { margin:0; font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:760px; margin:0 auto; padding:32px 16px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:12px; }
  h1 { font-size:20px; margin:0 0 6px; } h2 { margin:0 0 8px; font-size:18px; }
  p, li { color:var(--muted); } audio { width:100%; }
  .reveal { display:none; margin-top:10px; padding:10px; border-left:3px solid var(--accent); }
  .shown .reveal { display:block; }
  button { font:inherit; padding:8px 16px; border-radius:8px; border:1px solid var(--line); background:var(--panel); color:var(--text); cursor:pointer; }
</style></head><body><main>
<h1>${title}</h1><p>${intro}</p><ol>${questions.map(q => `<li>${q}</li>`).join("")}</ol>
<div id="cards">${cards}</div>
<button onclick="document.getElementById('cards').classList.add('shown'); this.remove()">Reveal which is which</button>
</main></body></html>`);
    return key;
}
