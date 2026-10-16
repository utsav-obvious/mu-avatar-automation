import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(ROOT, "..");
export const OUTPUT_DIR = path.join(ROOT, "output");
export const RESULTS_FILE = path.join(ROOT, "results.json");
export const CSV_FILE = path.join(REPO, "c8-scripts", "AI AVATAR__C8 R1 - SET 1.csv");
export const VARIANTS = ["raw", "rewritten"];

// Minimal RFC 4180 parser: handles quoted fields, "" escapes and newlines inside quotes.
export function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') inQuotes = false;
            else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); rows.push(row); row = []; field = "";
        } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const [header, ...body] = rows.filter(r => r.some(f => f.trim()));
    return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function nounRegex(original) {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(original)}(?![\\p{L}\\p{N}])`, "gu");
}

// Replace longest nouns first so "Jain University" isn't clobbered by a shorter match.
export function applyRewrites(text, nouns) {
    const changed = nouns
        .filter(n => n.rewritten !== n.original)
        .sort((a, b) => b.original.length - a.original.length);
    let out = text;
    for (const n of changed) out = out.replace(nounRegex(n.original), () => n.rewritten);
    return out;
}

export function loadScripts() {
    const rows = parseCsv(fs.readFileSync(CSV_FILE, "utf-8"));
    const { scripts: rewrites } = JSON.parse(fs.readFileSync(path.join(ROOT, "rewrites.json"), "utf-8"));
    return rows.map(r => {
        const id = r["Application Number"].trim();
        const raw = r["Founder Message"].trim();
        const nouns = rewrites[id]?.nouns ?? [];
        const missing = nouns.filter(n => !nounRegex(n.original).test(raw)).map(n => n.original);
        return {
            id,
            name: r["Name"].trim(),
            nouns,
            missing,
            texts: { raw, rewritten: applyRewrites(raw, nouns) },
        };
    });
}

export function loadEnv() {
    const env = { ...process.env };
    const file = path.join(REPO, ".env.local");
    if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
    }
    return env;
}
