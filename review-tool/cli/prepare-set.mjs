// Prepares a set from a CSV and (optionally) uploads it to Supabase.
//
//   node review-tool/cli/prepare-set.mjs review-tool/sets/c8-r1-set-1.json                   # preview only
//   node review-tool/cli/prepare-set.mjs review-tool/sets/c8-r1-set-1.json --upload          # create the set
//   ... --upload --replace      # re-upload a set nobody has started reviewing yet
//   ... --update-nouns          # refresh only the Fix-panel spelling options of an existing set
//                                 (keeps sentences, fixes and statuses untouched)
//
// Preview writes <spec>.preview.json; --upload writes <spec>.prepared.json, the record of exactly what was uploaded.

import fs from "fs";
import path from "path";
import { REPO, supabase, parseCsv, flag } from "./common.mjs";
import { toSpoken as applyTextRules, isNumberEntry } from "../../src/lib/review/spoken-rules.mjs";

const SEED = 42;
const specPath = process.argv[2];
if (!specPath || specPath.startsWith("--")) {
    console.error("Usage: prepare-set.mjs <set-spec.json> [--upload [--replace] | --update-nouns]");
    process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
const db = supabase();

// ---------- nouns: default spelling + Fix-panel options ----------

// Library wins over the spec; spoken === term means "approved as written".
const { data: library, error: libError } = await db.from("pronunciation_library").select("term, spoken, kind");
if (libError) throw libError;
const libraryByTerm = new Map(library.map(e => [e.term, e]));

const nouns = new Map(); // term → { kind, spoken, options[] }
for (const [term, n] of Object.entries(spec.nouns ?? {})) {
    nouns.set(term, { kind: n.kind ?? null, spoken: n.spoken ?? term, options: n.options ?? [] });
}
// Fixed phrases handled by the lead-in rule — a library entry for them would switch the rule off everywhere.
const LEAD_IN_TERMS = new Set(["When you spoke with", "Hey"]);

for (const e of library) {
    if (isNumberEntry(e.term)) continue; // numbers are handled by the number rule
    if (LEAD_IN_TERMS.has(e.term)) continue;
    const n = nouns.get(e.term) ?? { kind: e.kind, spoken: e.term, options: [] };
    nouns.set(e.term, { ...n, spoken: e.spoken });
}

const label = (text, term) => {
    if (/[ऀ-ॿ]/.test(text)) return "Devanagari";
    if (text === term) return "Original";
    if (/^([A-Z]\.?\s?){2,}$/.test(text.trim())) return "Letters";
    return "Respelling";
};

const optionsFor = (term, n) =>
    [...new Set([n.spoken, term, ...n.options])].map(text => ({ text, label: label(text, term) }));

// ---------- text ----------

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRegex = term => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "gu");

// Name/term spellings + number words + Devanagari lead-ins — shared with the app's Edit mode.
const spellings = new Map([...nouns].map(([term, n]) => [term, n.spoken]));
const toSpoken = sentence => applyTextRules(sentence, spellings);

// A full stop after these doesn't end a sentence ("St. Xavier's", "Rs. 1000", "Vidhi M. Jain", "O.P. Jindal").
const ABBREVIATION = /(?:^|\s)(?:St|Dr|Mr|Mrs|Ms|Prof|Jr|Sr|No|vs|Rs|e\.g|i\.e)\.$|(?:^|[\s.])[A-Z]\.$/;

function splitSentences(paragraph) {
    const parts = paragraph.split(/(?<=[.!?…])\s+/);
    const out = [];
    for (const part of parts) {
        // Join after an abbreviation, or when the next part starts lowercase ("family... we can't wait").
        if (out.length && (ABBREVIATION.test(out[out.length - 1]) || /^\p{Ll}/u.test(part))) out[out.length - 1] += " " + part;
        else out.push(part);
    }
    return out;
}

function sentencesOf(text) {
    return text.split(/\n+/).map(p => p.trim()).filter(Boolean)
        .flatMap((p, paragraph) => splitSentences(p).map(s => ({ original: s.trim(), paragraph })))
        .filter(s => /[\p{L}\p{N}]/u.test(s.original)); // drops stray punctuation like a lone "‚"
}

const rows = parseCsv(fs.readFileSync(path.join(REPO, spec.csv), "utf-8"));
const scripts = rows.map((r, position) => {
    const message = r["Founder Message"] ?? r["Corrected Founder Message"]
        ?? Object.entries(r).find(([k]) => /message/i.test(k))?.[1];
    if (message === undefined) throw new Error(`No message column in ${spec.csv} (expected "Founder Message").`);
    const original = message.trim();
    const changes = new Set();
    const sentences = sentencesOf(original).map(s => {
        const { spoken, used } = toSpoken(s.original);
        used.forEach(u => changes.add(u));
        return { original: s.original, spoken, paragraph: s.paragraph, seed: SEED };
    });
    const scriptNouns = [...nouns.entries()]
        .filter(([term]) => termRegex(term).test(original))
        .map(([term, n]) => ({ term, kind: n.kind, options: optionsFor(term, n) }));
    // Reviewers disagree on the Devanagari lead-in (Set 8 reverted it ~13×): keep it as the default, but
    // give a one-click chip row with English first. kind "lead-in" = never offered for the library.
    if (sentences.some(x => x.spoken.includes("वेन यू स्पोक विद"))) {
        scriptNouns.unshift({
            term: "When you spoke with",
            kind: "lead-in",
            options: [{ text: "When you spoke with", label: "English" }, { text: "वेन यू स्पोक विद", label: "Devanagari" }],
        });
    }
    return {
        position,
        application_number: r["Application Number"].trim(),
        student_name: r["Name"].trim(),
        original_text: original,
        sentences,
        nouns: scriptNouns,
        changes: [...changes],
    };
});

console.log(`${spec.name} · ${scripts.length} scripts · ${library.length} library entries applied\n`);
for (const s of scripts) {
    console.log(`${s.application_number}  ${s.student_name}  (${s.sentences.length} sentences, ${s.nouns.length} nouns with options)`);
    console.log(`   changed: ${s.changes.length ? s.changes.join(", ") : "nothing"}`);
}
// Interviewer pronouns must agree across the set (Set 8 had Gurneesh as "he" in 8 scripts, "she"/"they" in 2).
const pronouns = new Map(); // interviewer → { he|she|they: [students] }
for (const s of scripts) {
    const i = s.sentences.findIndex(x => /spoke with/.test(x.original));
    if (i < 0) continue;
    const who = s.sentences[i].original.match(/spoke with ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/)?.[1];
    if (!who) continue;
    const after = s.sentences[i].original.split(who)[1] + " " + (s.sentences[i + 1]?.original ?? "");
    const p = after.match(/\b(she|her|he|him|his|they|their)\b/i)?.[1].toLowerCase();
    const g = !p ? null : ["she", "her"].includes(p) ? "she" : ["he", "him", "his"].includes(p) ? "he" : "they";
    if (!g) continue;
    const key = who.split(" ")[0];
    const entry = pronouns.get(key) ?? {};
    (entry[g] ??= []).push(`${s.application_number} ${s.student_name}`);
    pronouns.set(key, entry);
}
for (const [who, byGender] of pronouns) {
    if (Object.keys(byGender).length < 2) continue;
    console.warn(`\n⚠️  ${who} is referred to inconsistently — fix the CSV wording (or Edit in /review) before reviewers start:`);
    for (const [g, list] of Object.entries(byGender)) console.warn(`     "${g}" ×${list.length}: ${list.join(", ")}`);
}

const unused = Object.keys(spec.nouns ?? {}).filter(t => !scripts.some(s => s.nouns.some(n => n.term === t)));
if (unused.length) console.warn(`\n⚠️  Nouns not found in any script: ${unused.join(", ")}`);

// <slug>.preview.json for previews; <slug>.prepared.json only for what was actually uploaded.
const uploading = flag("upload") || flag("update-nouns");
const writeRecord = suffix => {
    const outPath = specPath.replace(/\.json$/, suffix);
    fs.writeFileSync(outPath, JSON.stringify({ name: spec.name, filePrefix: spec.filePrefix, scripts }, null, 2));
    console.log(`\nWrote ${path.relative(REPO, outPath)}`);
};
if (!uploading) writeRecord(".preview.json");

// ---------- upload ----------

const { data: existing, error: findError } = await db.from("sets").select("id").eq("name", spec.name).maybeSingle();
if (findError) throw findError;

if (flag("update-nouns")) {
    if (!existing) {
        console.error(`\nSet "${spec.name}" doesn't exist yet — use --upload.`);
        process.exit(1);
    }
    for (const s of scripts) {
        const { error } = await db.from("scripts").update({ nouns: s.nouns })
            .eq("set_id", existing.id).eq("application_number", s.application_number);
        if (error) throw error;
    }
    console.log(`\n✅ Updated spelling options for ${scripts.length} scripts in "${spec.name}" (sentences untouched).`);
    console.log("   (.prepared.json not rewritten — it records the sentences as originally uploaded.)");
    process.exit(0);
}

if (!flag("upload")) {
    console.log("Preview only. Re-run with --upload to create the set, or --update-nouns to refresh options.");
    process.exit(0);
}

if (existing) {
    if (!flag("replace")) {
        console.error(`\nSet "${spec.name}" already exists. Use --replace to overwrite it (only allowed before review starts).`);
        process.exit(1);
    }
    const { count, error } = await db.from("scripts").select("id", { count: "exact", head: true })
        .eq("set_id", existing.id).neq("status", "pending");
    if (error) throw error;
    if (count > 0) {
        console.error(`\nRefusing to replace: ${count} script(s) in this set are already in review or approved.`);
        process.exit(1);
    }
    const { error: delError } = await db.from("sets").delete().eq("id", existing.id);
    if (delError) throw delError;
}

const { data: set, error: setError } = await db.from("sets")
    .insert({ name: spec.name, file_prefix: spec.filePrefix }).select("id").single();
if (setError) throw setError;
const { error: scriptsError } = await db.from("scripts").insert(
    scripts.map(({ changes, ...s }) => ({ ...s, set_id: set.id }))
);
if (scriptsError) throw scriptsError;
writeRecord(".prepared.json");
console.log(`\n✅ Uploaded "${spec.name}" with ${scripts.length} scripts.`);
