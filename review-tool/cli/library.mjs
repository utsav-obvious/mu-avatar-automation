// Pronunciation library CLI.
//   node review-tool/cli/library.mjs list
//   node review-tool/cli/library.mjs import review-tool/library-seed.json   # upsert by term
//   node review-tool/cli/library.mjs remove "94.4" "Saa-d"                  # delete entries (ask the user first)

import fs from "fs";
import { supabase } from "./common.mjs";

const [command, file] = process.argv.slice(2);
const db = supabase();

if (command === "list") {
    const { data, error } = await db.from("pronunciation_library").select("term, spoken, kind").order("term");
    if (error) throw error;
    for (const e of data) console.log(`${e.term.padEnd(40)} → ${e.spoken}${e.term === e.spoken ? "  (approved as written)" : ""}  [${e.kind ?? "-"}]`);
    console.log(`\n${data.length} entries`);
} else if (command === "import" && file) {
    const entries = JSON.parse(fs.readFileSync(file, "utf-8")).entries;
    const rows = entries.map(e => ({ term: e.term, spoken: e.spoken, kind: e.kind ?? null, updated_at: new Date().toISOString() }));
    const { error } = await db.from("pronunciation_library").upsert(rows, { onConflict: "term" });
    if (error) throw error;
    console.log(`Upserted ${rows.length} entries.`);
} else if (command === "remove" && process.argv.length > 3) {
    const terms = process.argv.slice(3);
    const { data, error } = await db.from("pronunciation_library").delete().in("term", terms).select("term");
    if (error) throw error;
    console.log(`Removed ${data.length}: ${data.map(e => e.term).join(", ") || "(none matched)"}`);
} else {
    console.error("Usage: library.mjs list | import <file.json> | remove <term> [term…]");
    process.exit(1);
}
