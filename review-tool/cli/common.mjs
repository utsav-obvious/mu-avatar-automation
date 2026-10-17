import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadEnv() {
    const env = { ...process.env };
    const file = path.join(REPO, ".env.local");
    if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
            if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
    }
    return env;
}

export function supabase() {
    const env = loadEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
        console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
        process.exit(1);
    }
    return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}

// Minimal RFC 4180 parser: quoted fields, "" escapes, newlines inside quotes.
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
    // Some sheets export with a blank header row (",,") — assume the standard 3 columns then.
    const blankHeader = rows.length && rows[0].every(f => !f.trim());
    const [header, ...body] = blankHeader
        ? [["Application Number", "Name", "Founder Message"], ...rows.slice(1).filter(r => r.some(f => f.trim()))]
        : rows.filter(r => r.some(f => f.trim()));
    return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
export const flag = name => process.argv.includes(`--${name}`);
