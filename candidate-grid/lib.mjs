import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { parseCsv, nounRegex, CSV_FILE } from "../v4-test/lib.mjs";

export { loadEnv } from "../v4-test/lib.mjs";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = path.join(ROOT, "output");
export const RESULTS_FILE = path.join(ROOT, "results.json");

export const nounKey = (scriptId, original) => `${scriptId}::${original}`;
// Clip files are named by a hash of the candidate text, so editing candidates.json never mixes up clips.
export const clipId = text => crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
export const slug = s => s.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "noun";

function splitSentences(text) {
    return text.split(/\n+/).flatMap(p => p.split(/(?<=[.!?])\s+/)).map(s => s.trim()).filter(Boolean);
}

export function loadConfig() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "candidates.json"), "utf-8"));
}

// Returns one entry per noun with its context sentence and every candidate spliced into it.
export function loadNouns() {
    const config = loadConfig();
    const rows = Object.fromEntries(
        parseCsv(fs.readFileSync(CSV_FILE, "utf-8")).map(r => [r["Application Number"].trim(), r])
    );
    const nouns = [];
    for (const [scriptId, list] of Object.entries(config.scripts)) {
        const row = rows[scriptId];
        if (!row) throw new Error(`Script ${scriptId} not found in CSV`);
        for (const n of list) {
            const hits = splitSentences(row["Founder Message"]).filter(s => nounRegex(n.original).test(s));
            const sentence = hits[n.occurrence ?? 0];
            if (!sentence) throw new Error(`"${n.original}" not found (occurrence ${n.occurrence ?? 0}) in ${scriptId}`);
            const m = nounRegex(n.original).exec(sentence);
            const prefix = sentence.slice(0, m.index);
            const suffix = sentence.slice(m.index + n.original.length);
            nouns.push({
                key: nounKey(scriptId, n.original),
                scriptId,
                studentName: row["Name"].trim(),
                dir: path.join(OUTPUT_DIR, scriptId, slug(n.original)),
                ...n,
                sentence,
                candidates: n.candidates.map(c => ({
                    ...c,
                    id: clipId(c.text),
                    sentence: prefix + c.text + suffix,
                    offset: prefix.length,
                })),
            });
        }
    }
    return { model: config.model, nouns };
}
