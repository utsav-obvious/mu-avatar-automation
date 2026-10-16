// Parallel test: generate every sentence at once with neighbour-text context only (no request ids),
// and compare blind against the sequential "context" version and the one-shot from run.mjs.
//
//   node join-test/parallel.mjs [--concurrency N]   # default: all sentences at once
//   open join-test/output-parallel/index.html

import fs from "fs";
import path from "path";
import { ROOT, SCRIPT_ID, MODEL, loadSentences, tts, join, getFormat, writeBlindPage } from "./lib.mjs";

const PREV = path.join(ROOT, "output");
const OUT = path.join(ROOT, "output-parallel");
const prevKey = JSON.parse(fs.readFileSync(path.join(PREV, "key.json"), "utf-8")).key;
const prevFile = version => path.join(PREV, `${Object.keys(prevKey).find(l => prevKey[l].version === version)}.wav`);

const { sentences } = loadSentences();
const i = process.argv.indexOf("--concurrency");
const CONCURRENCY = i > 0 ? Number(process.argv[i + 1]) : sentences.length;

let rateLimited = 0;
async function withRetry(fn) {
    for (let attempt = 0; ; attempt++) {
        try { return await fn(); }
        catch (err) {
            if (err.status !== 429 || attempt >= 5) throw err;
            rateLimited++;
            await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        }
    }
}

console.log(`${SCRIPT_ID} · ${MODEL} · ${sentences.length} sentences · concurrency ${CONCURRENCY}\n`);

const clips = new Array(sentences.length);
const latencies = new Array(sentences.length);
let firstHeaders = null;
const queue = sentences.map((_, idx) => idx);
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
        const idx = queue.shift();
        const t0 = Date.now();
        const r = await withRetry(() => tts(sentences[idx].text, {
            previous_text: sentences[idx - 1]?.text,
            next_text: sentences[idx + 1]?.text,
        }));
        latencies[idx] = (Date.now() - t0) / 1000;
        clips[idx] = r.pcm;
        firstHeaders ??= r.headers;
        console.log(`  sentence ${idx + 1} done in ${latencies[idx].toFixed(1)}s`);
    }
}));
const wall = (Date.now() - started) / 1000;
const sum = latencies.reduce((a, b) => a + b, 0);

const limitHeaders = [...firstHeaders.entries()].filter(([k]) => /concurr|ratelimit|character/i.test(k));
console.log(`\nWall time: ${wall.toFixed(1)}s · one-after-another would take ≈ ${sum.toFixed(1)}s · 429 retries: ${rateLimited}`);
if (limitHeaders.length) console.log(`Limit headers: ${limitHeaders.map(([k, v]) => `${k}=${v}`).join(", ")}`);

const key = writeBlindPage(
    OUT,
    `Parallel test — ${SCRIPT_ID}`,
    "Same script, three ways. Listen without peeking: <b>does it sound like one continuous reading?</b>",
    ["Which sounds most natural?", "Can you hear where sentences were joined in any of them?", "Is any one noticeably worse than the others?"],
    [
        { version: "parallel", pcm: join(clips, sentences), about: `NEW — all sentences generated at the same time, neighbour text only (${wall.toFixed(1)}s wall time).` },
        { version: "sequential-context", copyFrom: prevFile("context"), about: "From the last test (was D) — sentences one after another, neighbour text + previous request ids." },
        { version: "one-shot", copyFrom: prevFile("one-shot"), about: "From the last test (was B) — whole script in one request." },
    ]
);
fs.writeFileSync(path.join(OUT, "key.json"), JSON.stringify({
    script: SCRIPT_ID, model: MODEL, format: getFormat(), concurrency: CONCURRENCY,
    wallSeconds: +wall.toFixed(1), sequentialEstimateSeconds: +sum.toFixed(1), rateLimitRetries: rateLimited,
    latencies, key,
}, null, 2));

console.log(`\nOpen: join-test/output-parallel/index.html`);
