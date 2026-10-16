// Generates raw + rewritten audio per script with ElevenLabs v4.
//
//   node v4-test/generate.mjs --dry-run                  # print rewritten scripts, no API calls
//   node v4-test/generate.mjs --ids MUSB-C8-71478,MUSB-C8-94587
//   node v4-test/generate.mjs --limit 2                  # first N scripts
//   node v4-test/generate.mjs --all
//   add --force to regenerate files that already exist.

import fs from "fs";
import path from "path";
import { loadScripts, loadEnv, OUTPUT_DIR, VARIANTS } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const env = loadEnv();
const API_KEY = env.ELEVEN_LABS_API_KEY;
const VOICE_ID = env.ELEVEN_LABS_VOICE_ID;
const MODEL = opt("model") || "eleven_v4";
const SEED = 42; // same seed for raw and rewritten so the only difference is the text
const OUTPUT_FORMAT = "mp3_44100_128";

const all = loadScripts();
let selected;
if (opt("ids")) {
    const ids = opt("ids").split(",").map(s => s.trim());
    selected = all.filter(s => ids.includes(s.id));
    const unknown = ids.filter(id => !all.some(s => s.id === id));
    if (unknown.length) { console.error(`Unknown ids: ${unknown.join(", ")}`); process.exit(1); }
} else if (opt("limit")) selected = all.slice(0, Number(opt("limit")));
else if (flag("all") || flag("dry-run")) selected = all;
else {
    console.error("Pick scripts with --ids, --limit N or --all (or use --dry-run).");
    process.exit(1);
}

for (const s of selected) {
    if (s.missing.length) console.warn(`⚠️  ${s.id}: nouns not found in script text: ${s.missing.join(", ")}`);
}

if (flag("dry-run")) {
    for (const s of selected) {
        console.log(`\n===== ${s.id} | ${s.name} =====\n${s.texts.rewritten}`);
    }
    process.exit(0);
}

if (!API_KEY || !VOICE_ID) {
    console.error("ELEVEN_LABS_API_KEY and ELEVEN_LABS_VOICE_ID must be set in .env.local");
    process.exit(1);
}

// One report says /v1/text-to-speech rejects v4 ids (unsupported_model) while
// /v1/text-to-dialogue accepts them, so try TTS first and fall back once.
let preferDialogue = false;

async function callTts(text) {
    const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`,
        {
            method: "POST",
            headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify({
                text,
                model_id: MODEL,
                seed: SEED,
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
        }
    );
    return { res, endpoint: "text-to-speech" };
}

async function callDialogue(text) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${OUTPUT_FORMAT}`, {
        method: "POST",
        headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
            inputs: [{ text, voice_id: VOICE_ID }],
            model_id: MODEL,
            seed: SEED,
            settings: { stability: 0.5, similarity: 0.75 },
        }),
    });
    return { res, endpoint: "text-to-dialogue" };
}

async function synthesize(text) {
    let attempt = preferDialogue ? await callDialogue(text) : await callTts(text);
    if (!attempt.res.ok && !preferDialogue && [400, 422].includes(attempt.res.status)) {
        const body = await attempt.res.text();
        if (/model/i.test(body)) {
            console.warn(`   text-to-speech rejected ${MODEL} (${body.slice(0, 160)}) → retrying via text-to-dialogue`);
            preferDialogue = true;
            attempt = await callDialogue(text);
        } else {
            throw new Error(`${attempt.endpoint} ${attempt.res.status}: ${body}`);
        }
    }
    if (!attempt.res.ok) throw new Error(`${attempt.endpoint} ${attempt.res.status}: ${await attempt.res.text()}`);
    return {
        audio: Buffer.from(await attempt.res.arrayBuffer()),
        endpoint: attempt.endpoint,
        requestId: attempt.res.headers.get("request-id"),
        characterCost: attempt.res.headers.get("x-character-count"),
    };
}

console.log(`Model ${MODEL} · voice ${VOICE_ID} · ${selected.length} script(s) × ${VARIANTS.length} variants\n`);

for (const s of selected) {
    const dir = path.join(OUTPUT_DIR, s.id);
    fs.mkdirSync(dir, { recursive: true });

    for (const variant of VARIANTS) {
        const mp3 = path.join(dir, `${variant}.mp3`);
        if (fs.existsSync(mp3) && !flag("force")) {
            console.log(`⏭  ${s.id} ${variant}: exists (use --force to regenerate)`);
            continue;
        }
        const text = s.texts[variant];
        process.stdout.write(`🎙  ${s.id} ${variant} (${text.length} chars)… `);
        try {
            const out = await synthesize(text);
            fs.writeFileSync(mp3, out.audio);
            fs.writeFileSync(
                path.join(dir, `${variant}.json`),
                JSON.stringify({
                    model: MODEL,
                    voiceId: VOICE_ID,
                    endpoint: out.endpoint,
                    seed: SEED,
                    requestId: out.requestId,
                    characterCost: out.characterCost,
                    generatedAt: new Date().toISOString(),
                    text,
                }, null, 2)
            );
            console.log(`done via ${out.endpoint} (${(out.audio.length / 1024).toFixed(0)} KB)`);
        } catch (err) {
            console.log("FAILED");
            console.error(`   ${err.message}`);
        }
    }
}

console.log(`\nReview: node v4-test/serve.mjs  →  http://localhost:4310`);
