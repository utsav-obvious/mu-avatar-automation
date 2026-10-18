// Analyse the reviewer change log (sentence_changes) — run before preparing a new set, so repeated
// fixes become preparation rules and library entries.
//
//   node review-tool/cli/changes.mjs                          # everything
//   node review-tool/cli/changes.mjs --set "C8 R1 – Set 1"    # one set
//   node review-tool/cli/changes.mjs --since 2026-10-10       # recent only
//   node review-tool/cli/changes.mjs --csv changes.csv        # also export raw rows

import fs from "fs";
import { supabase, arg } from "./common.mjs";

const db = supabase();

async function fetchAll() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        let q = db.from("sentence_changes").select("*").order("created_at").range(from, from + 999);
        if (arg("set")) q = q.eq("set_name", arg("set"));
        if (arg("since")) q = q.gte("created_at", arg("since"));
        const { data, error } = await q;
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) return rows;
    }
}

// Word-level diff (LCS) → hunks of { removed, added }.
function diff(before = "", after = "") {
    const a = before.split(/\s+/).filter(Boolean), b = after.split(/\s+/).filter(Boolean);
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hunks = [];
    let i = 0, j = 0, cur = null;
    const flush = () => { if (cur) hunks.push({ removed: cur.r.join(" "), added: cur.a.join(" ") }); cur = null; };
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
        else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) { (cur ??= { r: [], a: [] }).a.push(b[j++]); }
        else { (cur ??= { r: [], a: [] }).r.push(a[i++]); }
    }
    flush();
    return hunks;
}

const DEVANAGARI = /[ऀ-ॿ]/;
function classify({ removed, added }) {
    const tags = [];
    const squash = s => s.replace(/[\s.,;:!?'’"()-]/g, "");
    if (squash(removed) === squash(added)) tags.push("spacing/punctuation");
    if (/\d/.test(removed + added)) tags.push("number");
    if (DEVANAGARI.test(removed) || DEVANAGARI.test(added)) tags.push("devanagari");
    if (/^[A-Z](?:[\s.]?[A-Z])+\.?$/.test(added.trim()) || /^[A-Z](?:[\s.]?[A-Z])+\.?$/.test(removed.trim())) tags.push("acronym");
    if (!tags.length) tags.push(removed && added ? "respelling/wording" : removed ? "removed words" : "added words");
    return tags.join(" + ");
}

const rows = await fetchAll();
if (!rows.length) {
    console.log("No changes logged yet.");
    process.exit(0);
}

const count = (list, key) => list.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map());
const byAction = count(rows, r => r.action);
const byReviewer = count(rows, r => r.reviewer ?? "unknown");
const scripts = new Set(rows.map(r => r.application_number));

console.log(`\n${rows.length} logged actions · ${scripts.size} scripts · ${rows[0].created_at.slice(0, 10)} → ${rows.at(-1).created_at.slice(0, 10)}`);
console.log(`Actions:   ${[...byAction].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`Reviewers: ${[...byReviewer].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
const perReviewer = new Map();
for (const r of rows) {
    const e = perReviewer.get(r.reviewer ?? "unknown") ?? { takes: 0, scripts: new Set() };
    if (r.action === "take") e.takes++;
    e.scripts.add(r.application_number);
    perReviewer.set(r.reviewer ?? "unknown", e);
}
console.log(`Takes per script: ${[...perReviewer].map(([k, e]) => `${k} ${(e.takes / e.scripts.size).toFixed(1)}`).join(" · ")}   (compare reviewers before blaming a rule)`);

// ---- kept changes, grouped into patterns ----
const kept = rows.filter(r => r.action === "fix" || r.action === "edit");
const keptTakes = new Set(kept.map(r => r.take_id).filter(Boolean));
const patterns = new Map(); // "removed → added" → { tag, count, scripts, reviewers, sets, removed, added }
for (const r of kept) {
    for (const h of diff(r.before_spoken, r.after_spoken)) {
        const key = `${h.removed || "∅"}  →  ${h.added || "∅"}`;
        const p = patterns.get(key) ?? { tag: classify(h), count: 0, scripts: new Set(), reviewers: new Set(), sets: new Set(), removed: h.removed, added: h.added };
        p.count++;
        p.scripts.add(r.application_number);
        p.reviewers.add(r.reviewer ?? "unknown");
        p.sets.add(r.set_name ?? "?");
        patterns.set(key, p);
    }
}
// Rule-change policy (CLAUDE.md): a pattern is rule-ready only with enough, consistent, multi-reviewer evidence.
const RULE_READY = { count: 5, reviewers: 2, sets: 2 };
const reversedCount = p => patterns.get(`${p.added || "∅"}  →  ${p.removed || "∅"}`)?.count ?? 0;
const evidence = p => {
    const rev = reversedCount(p);
    const ready = p.count >= RULE_READY.count && p.reviewers.size >= RULE_READY.reviewers && p.sets.size >= RULE_READY.sets && rev * 3 <= p.count;
    return `[${p.reviewers.size} reviewer${p.reviewers.size > 1 ? "s" : ""} · ${p.sets.size} set${p.sets.size > 1 ? "s" : ""}${rev ? ` · reversed ${rev}×` : ""}]${ready ? "  ✓ rule-ready" : ""}`;
};
console.log(`\n== Kept changes to the text sent to ElevenLabs (${kept.length} fixes/edits) ==`);
console.log(`   ✓ rule-ready = ≥ ${RULE_READY.count}× by ≥ ${RULE_READY.reviewers} reviewers in ≥ ${RULE_READY.sets} sets, reversed ≤ ⅓ as often (see CLAUDE.md "Rule-change policy")`);
const byTag = new Map();
for (const [key, p] of patterns) byTag.set(p.tag, [...(byTag.get(p.tag) ?? []), [key, p]]);
for (const [tag, list] of [...byTag].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n[${tag}]`);
    for (const [key, p] of list.sort((a, b) => b[1].count - a[1].count)) {
        console.log(`  ${String(p.count).padStart(3)}×  ${key}   ${evidence(p)}   (${[...p.scripts].slice(0, 6).join(", ")}${p.scripts.size > 6 ? ", …" : ""})`);
    }
}

// ---- kept re-takes: same text, new seed (the reading was off, not the spelling) ----
const rerolls = kept.filter(r => r.before_spoken === r.after_spoken && r.before_original === r.after_original);
if (rerolls.length) {
    console.log(`\n== Fixed by just another take — same text, new reading (${rerolls.length} of ${kept.length} kept fixes) ==`);
    for (const r of rerolls) console.log(`  ${r.application_number} #${r.sentence_index + 1}:  “${r.after_original.slice(0, 90)}${r.after_original.length > 90 ? "…" : ""}”`);
}

// ---- wording edits (what reviewers read) ----
const wording = kept.filter(r => r.action === "edit" && r.before_original !== r.after_original);
if (wording.length) {
    console.log(`\n== Wording edits (${wording.length}) ==`);
    for (const r of wording)
        for (const h of diff(r.before_original, r.after_original))
            console.log(`  ${r.application_number} #${r.sentence_index + 1}:  ${h.removed || "∅"}  →  ${h.added || "∅"}`);
}

// ---- library entries ----
const lib = kept.filter(r => r.library_term);
if (lib.length) {
    console.log(`\n== Library entries saved (${lib.length}) ==`);
    for (const r of lib) console.log(`  ${r.library_term}  →  ${r.library_spoken}   (${r.reviewer})`);
}

// ---- attempts that were not kept ----
const discarded = rows.filter(r => r.action === "take" && !keptTakes.has(r.take_id));
if (discarded.length) {
    console.log(`\n== Takes generated but not kept (${discarded.length}) — spellings that didn't work ==`);
    for (const r of discarded) {
        const hunks = diff(r.before_spoken, r.after_spoken);
        const what = hunks.length ? hunks.map(h => `${h.removed || "∅"} → ${h.added || "∅"}`).join("; ") : "(same text, another take)";
        console.log(`  ${r.application_number} #${r.sentence_index + 1}:  ${what}`);
    }
}

// ---- deletions ----
const deletes = rows.filter(r => r.action === "delete");
const undone = new Set(rows.filter(r => r.action === "undo").map(r => `${r.application_number}#${r.sentence_index}`));
const realDeletes = deletes.filter(r => !undone.has(`${r.application_number}#${r.sentence_index}`));
if (realDeletes.length) {
    console.log(`\n== Sentences deleted (${realDeletes.length}) ==`);
    for (const r of realDeletes) console.log(`  ${r.application_number} #${r.sentence_index + 1}:  “${r.before_original}”`);
}

if (arg("csv")) {
    const cols = Object.keys(rows[0]);
    const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    fs.writeFileSync(arg("csv"), "﻿" + [cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\n"));
    console.log(`\nWrote ${rows.length} rows to ${arg("csv")}`);
}
