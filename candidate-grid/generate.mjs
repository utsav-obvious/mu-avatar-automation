// Generates one sentence-level clip per pronunciation candidate (eleven_multilingual_v2 + timestamps).
//
//   node candidate-grid/generate.mjs --dry-run     # list sentences + character count, no API calls
//   node candidate-grid/generate.mjs               # generate missing clips
//   node candidate-grid/generate.mjs --force       # regenerate everything

import fs from "fs";
import path from "path";
import { loadNouns, loadEnv } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);

const env = loadEnv();
const API_KEY = env.ELEVEN_LABS_API_KEY;
const VOICE_ID = env.ELEVEN_LABS_VOICE_ID;
const SEED = 42;
const CONCURRENCY = 3;

const { model, nouns } = loadNouns();
const jobs = nouns.flatMap(n => n.candidates.map(c => ({ n, c })));

if (flag("dry-run")) {
    for (const n of nouns) {
        console.log(`\n${n.key}  →  ${n.sentence}`);
        for (const c of n.candidates) console.log(`   [${c.technique}] ${c.sentence}`);
    }
    const chars = jobs.reduce((sum, j) => sum + j.c.sentence.length, 0);
    console.log(`\n${jobs.length} clips · ~${chars} characters on ${model}`);
    process.exit(0);
}

if (!API_KEY || !VOICE_ID) {
    console.error("ELEVEN_LABS_API_KEY and ELEVEN_LABS_VOICE_ID must be set in .env.local");
    process.exit(1);
}

async function synthesize(text) {
    const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
        {
            method: "POST",
            headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
                text,
                model_id: model,
                seed: SEED,
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
        }
    );
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
}

// Time range of the candidate inside the sentence, from per-character alignment.
function findSpan(alignment, sentence, candidate, offset) {
    if (!alignment) return null;
    const chars = alignment.characters;
    const joined = chars.join("");
    let start = joined === sentence ? offset : joined.indexOf(candidate);
    if (start < 0) return null;
    // characters[] may hold multi-code-unit entries; map string offset -> array index.
    let pos = 0, startIdx = -1, endIdx = -1;
    for (let i = 0; i < chars.length; i++) {
        if (startIdx < 0 && pos + chars[i].length > start) startIdx = i;
        if (pos + chars[i].length >= start + candidate.length) { endIdx = i; break; }
        pos += chars[i].length;
    }
    if (startIdx < 0 || endIdx < 0) return null;
    return {
        start: alignment.character_start_times_seconds[startIdx],
        end: alignment.character_end_times_seconds[endIdx],
    };
}

async function run({ n, c }) {
    const mp3 = path.join(n.dir, `${c.id}.mp3`);
    if (fs.existsSync(mp3) && !flag("force")) return `⏭  ${n.original} [${c.technique}] exists`;
    fs.mkdirSync(n.dir, { recursive: true });
    const out = await synthesize(c.sentence);
    const span = findSpan(out.alignment, c.sentence, c.text, c.offset);
    fs.writeFileSync(mp3, Buffer.from(out.audio_base64, "base64"));
    fs.writeFileSync(path.join(n.dir, `${c.id}.json`), JSON.stringify({
        text: c.text,
        technique: c.technique,
        sentence: c.sentence,
        span,
        model,
        voiceId: VOICE_ID,
        seed: SEED,
        generatedAt: new Date().toISOString(),
    }, null, 2));
    return `🎙  ${n.original} [${c.technique}] "${c.text}" ${span ? `${span.start.toFixed(2)}–${span.end.toFixed(2)}s` : "(no span found)"}`;
}

console.log(`${model} · voice ${VOICE_ID} · ${jobs.length} clips\n`);
const queue = [...jobs];
let failed = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
        const job = queue.shift();
        try {
            console.log(await run(job));
        } catch (err) {
            failed++;
            console.log(`❌ ${job.n.original} [${job.c.technique}] ${err.message}`);
        }
    }
}));

console.log(`\n${failed ? `${failed} failed. ` : ""}Review: node candidate-grid/serve.mjs  →  http://localhost:4311`);
