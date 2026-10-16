// Imports client comments on a delivered set, with the suggested sentence fixes, so reviewers can patch
// the delivered audio in /review (only the flagged sentences are regenerated; scripts stay approved).
//
//   node review-tool/cli/import-feedback.mjs review-tool/feedback/c8-r1-set-2.json            # preview only
//   node review-tool/cli/import-feedback.mjs review-tool/feedback/c8-r1-set-2.json --upload   # write to Supabase
//
// The spec (comments in this block are explanation only — the real file is plain JSON):
//   {
//     "set": "C8 R1 – Set 2",
//     "csv": "c8-scripts/Comments-added/<file>.csv",     // comment column "comment"; "No regen" in any other column
//     "spellings": { "Saad": "साअद", "DPS": "D P S" },     // overrides for this round, on top of the script's current spellings
//     "suggestions": {
//       "MUYLC-C3-83023": [
//         { "sentence": 4, "note": "…" },                  // 1-based, as numbered in /review; text = current wording, re-spoken with today's rules
//         { "sentence": 5, "original": "New wording…", "note": "…" },  // the client changed the wording
//         { "sentence": 6, "spoken": "exact text to send", "note": "…" }
//       ]
//     }
//   }
// Spoken text = the spelling each name currently has in that sentence (else library / prepared default),
// then `spellings`, then the shared rules (numbers as words, Devanagari lead-ins…) — the same as Edit mode.
// Feedback specs name students' application numbers: keep them local (git-ignored).

import fs from "fs";
import path from "path";
import { REPO, supabase, parseCsv, flag } from "./common.mjs";
import { toSpoken as applyTextRules, isNumberEntry } from "../../src/lib/review/spoken-rules.mjs";

const specPath = process.argv[2];
if (!specPath || specPath.startsWith("--")) {
    console.error("Usage: import-feedback.mjs <feedback-spec.json> [--upload]");
    process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
const db = supabase();

const { data: set, error: setError } = await db.from("sets").select("id, name").eq("name", spec.set).maybeSingle();
if (setError) throw setError;
if (!set) {
    console.error(`Set "${spec.set}" not found.`);
    process.exit(1);
}
const { data: scripts, error: scriptsError } = await db.from("scripts")
    .select("id, application_number, student_name, status, original_text, sentences, nouns")
    .eq("set_id", set.id).order("position");
if (scriptsError) throw scriptsError;
const byNumber = new Map(scripts.map(s => [s.application_number, s]));

const { data: library, error: libError } = await db.from("pronunciation_library").select("term, spoken");
if (libError) throw libError;

// ---------- spoken text, as Edit mode does it (FixPanel.tsx toSpoken) ----------

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRegex = s => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegex(s)}(?![\\p{L}\\p{M}\\p{N}])`, "u");
const currentOption = (noun, text) =>
    [...noun.options].sort((a, b) => b.text.length - a.text.length).find(o => wordRegex(o.text).test(text)) ?? null;

function spokenFor(script, original, previousSpoken) {
    const choices = new Map(library.filter(e => !isNumberEntry(e.term)).map(e => [e.term, e.spoken]));
    for (const n of script.nouns ?? []) choices.set(n.term, currentOption(n, previousSpoken)?.text ?? n.options[0]?.text ?? n.term);
    for (const [term, spoken] of Object.entries(spec.spellings ?? {})) choices.set(term, spoken);
    return applyTextRules(original, choices).spoken;
}

// ---------- comments from the CSV ----------

const rows = parseCsv(fs.readFileSync(path.join(REPO, spec.csv), "utf-8"));
const source = path.basename(spec.csv);
const sentencesOf = text => text.split(/\n+|(?<=[.!?…])\s+/).map(t => t.trim()).filter(Boolean);
const importedAt = new Date().toISOString();
const updates = [];
let problems = 0;

for (const row of rows) {
    const number = (row["Application Number"] ?? "").trim();
    const comment = (row["comment"] ?? row["Comment"] ?? "").trim();
    const noRegen = Object.entries(row).some(([k, v]) => k !== "comment" && /no\s*-?\s*regen/i.test(v));
    const suggestions = spec.suggestions?.[number] ?? [];
    if (!comment && !suggestions.length) continue;
    const script = byNumber.get(number);
    if (!script) {
        console.error(`❌ ${number}: not in "${spec.set}".`);
        problems++;
        continue;
    }

    console.log(`\n=== ${number}  ${script.student_name}  [${script.status}]${noRegen ? "  · NO REGEN" : ""}`);
    console.log(`    “${comment.replace(/\s*\n\s*/g, " / ")}”`);
    if (script.status !== "approved") console.warn("    ⚠️  Not approved — it will be fixed through normal review, not patched.");

    // Wording the client changed after the audio was made (their sheet vs what was voiced).
    const message = (row["Founder Message"] ?? row["Corrected Founder Message"] ?? "").trim();
    if (message) {
        const voiced = new Set(sentencesOf(script.original_text));
        for (const t of sentencesOf(message).filter(t => !voiced.has(t))) console.log(`    ✎ client's sheet now says: ${t}`);
    }

    const prepared = [];
    for (const sg of suggestions) {
        const index = sg.sentence - 1;
        const current = script.sentences[index];
        if (!Number.isInteger(sg.sentence) || !current) {
            console.error(`    ❌ sentence ${sg.sentence} doesn't exist (script has ${script.sentences.length}).`);
            problems++;
            continue;
        }
        const original = sg.original ?? current.original;
        const spoken = sg.spoken ?? spokenFor(script, original, current.spoken);
        console.log(`    #${sg.sentence}  now:  ${current.spoken}`);
        if (original !== current.original) console.log(`         text: ${original}`);
        console.log(`         send: ${spoken}${spoken === current.spoken ? "   (same text — a new take)" : ""}`);
        if (sg.note) console.log(`         note: ${sg.note}`);
        prepared.push({ index, original, spoken, note: sg.note ?? "" });
    }
    if (!noRegen && !prepared.length) console.warn("    ⚠️  No suggestion prepared — reviewers only see the comment.");
    if (noRegen && prepared.length) console.warn("    ⚠️  Marked No regen but has suggestions — they won't be shown.");

    updates.push({
        id: script.id,
        feedback: { comment, no_regen: noRegen, source, imported_at: importedAt, suggestions: noRegen ? [] : prepared },
    });
}

console.log(`\n${updates.length} scripts with feedback (${updates.filter(u => u.feedback.no_regen).length} no regen).`);
if (problems) {
    console.error(`${problems} problem(s) — fix the spec before uploading.`);
    process.exit(1);
}
if (!flag("upload")) {
    console.log("Preview only. Re-run with --upload to attach the feedback in /review.");
    process.exit(0);
}
for (const u of updates) {
    const { error } = await db.from("scripts").update({ feedback: u.feedback }).eq("id", u.id);
    if (error) throw error;
}
console.log(`✅ Feedback attached to ${updates.length} scripts in "${spec.set}". Statuses untouched — reload /review.`);
