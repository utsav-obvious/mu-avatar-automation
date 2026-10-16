// Join test: does a script generated sentence-by-sentence sound as natural as one generated in one go?
//
//   node join-test/run.mjs            # generates 4 blind versions into join-test/output/
//   open join-test/output/index.html  # listen, then click "Reveal"
//
// Versions (shuffled to A–D):
//   one-shot        whole script in one request (reference)
//   no-context      each sentence its own request, no context
//   context         each sentence with previous/next sentence text + previous request ids
//   context-regen   "context", but one middle sentence regenerated later with text context only
//                   (request ids expire after 2h, so a reviewer's regen can only use neighbour text)

import fs from "fs";
import path from "path";
import { ROOT, SCRIPT_ID, MODEL, loadSentences, tts, join, startOf, getFormat, writeBlindPage } from "./lib.mjs";

const OUT = path.join(ROOT, "output");
const { text, sentences } = loadSentences();
const REGEN_INDEX = sentences.findIndex(s => s.text.includes("प्रियदर्शी")); // the sentence a reviewer would most likely regen

console.log(`${SCRIPT_ID} · ${MODEL} · ${sentences.length} sentences\n`);

console.log("1/4 one-shot");
const oneShot = await tts(text);

console.log("2/4 no-context");
const noContext = [];
for (const s of sentences) noContext.push((await tts(s.text)).pcm);

console.log("3/4 context");
const context = [], requestIds = [];
for (const [i, s] of sentences.entries()) {
    const r = await tts(s.text, {
        previous_text: sentences[i - 1]?.text,
        next_text: sentences[i + 1]?.text,
        previous_request_ids: requestIds.slice(-3),
    });
    context.push(r.pcm);
    if (r.requestId) requestIds.push(r.requestId);
    process.stdout.write(".");
}
console.log();

console.log(`4/4 context-regen (sentence ${REGEN_INDEX + 1}, text context only, different seed)`);
const regen = await tts(sentences[REGEN_INDEX].text, {
    seed: 7,
    previous_text: sentences[REGEN_INDEX - 1]?.text,
    next_text: sentences[REGEN_INDEX + 1]?.text,
});
const contextRegen = context.map((c, i) => (i === REGEN_INDEX ? regen.pcm : c));

const key = writeBlindPage(
    OUT,
    `Join test — ${SCRIPT_ID}`,
    "Same script, four ways. Listen to each without peeking. For each one ask: <b>does it sound like one continuous reading?</b> Can you hear jumps in pace, pitch or energy between sentences?",
    ["Which sounds most natural?", "Can you hear where sentences were joined in any of them?", "Is there one sentence that sounds “off” compared to its neighbours?"],
    [
        { version: "one-shot", pcm: oneShot.pcm, about: "Whole script in one request (reference — today's quality)." },
        { version: "no-context", pcm: join(noContext, sentences), about: "Each sentence generated alone, no context." },
        { version: "context", pcm: join(context, sentences), about: "Each sentence with neighbouring sentence text + previous request ids." },
        {
            version: "context-regen",
            pcm: join(contextRegen, sentences),
            about: `Same as "context", but sentence ${REGEN_INDEX + 1} was regenerated as a reviewer would days later (neighbour text only). It starts at ${startOf(contextRegen, sentences, REGEN_INDEX).toFixed(1)}s: “${sentences[REGEN_INDEX].text}”`,
        },
    ]
);
fs.writeFileSync(path.join(OUT, "key.json"), JSON.stringify({ script: SCRIPT_ID, model: MODEL, format: getFormat(), sentences, key }, null, 2));

console.log(`\nDone (${getFormat()}). Open: join-test/output/index.html`);
