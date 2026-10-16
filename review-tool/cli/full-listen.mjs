// Full-listen rule: scripts regenerated after delivery must be heard sentence by sentence before they are
// approved (or, if already approved, confirmed) in /review. Reopening a script without stored clips sets
// this automatically; use this CLI for scripts regenerated before the rule existed.
//
//   node review-tool/cli/full-listen.mjs list                                              # every flagged script
//   node review-tool/cli/full-listen.mjs flag "C8 R1 – Set 2" MUYLC-C3-83023 MUSB-C8-80864  # preview
//   node review-tool/cli/full-listen.mjs flag "C8 R1 – Set 2" MUYLC-C3-83023 --yes           # write (ask the user first)
//   node review-tool/cli/full-listen.mjs clear "C8 R1 – Set 2" MUYLC-C3-83023 --yes
//   --reason "…"  overrides the default reason shown to reviewers

import { supabase, arg, flag } from "./common.mjs";

const [command, setName, ...rest] = process.argv.slice(2);
const numbers = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--reason");
const db = supabase();

if (command === "list") {
    const { data, error } = await db.from("scripts")
        .select("application_number, student_name, status, full_listen, sets(name)")
        .not("full_listen", "is", null).order("set_id");
    if (error) throw error;
    for (const s of data) console.log(`${s.sets.name} · ${s.application_number} ${s.student_name} · ${s.status} · ${s.full_listen.at.slice(0, 10)} ${s.full_listen.by}: ${s.full_listen.reason}`);
    console.log(`\n${data.length} script(s) need a full listen.`);
} else if ((command === "flag" || command === "clear") && setName && numbers.length) {
    const { data: set, error: setError } = await db.from("sets").select("id").eq("name", setName).maybeSingle();
    if (setError) throw setError;
    if (!set) {
        console.error(`Set "${setName}" not found.`);
        process.exit(1);
    }
    const { data: scripts, error } = await db.from("scripts")
        .select("id, application_number, student_name, status, full_listen")
        .eq("set_id", set.id).in("application_number", numbers);
    if (error) throw error;
    const missing = numbers.filter(n => !scripts.some(s => s.application_number === n));
    if (missing.length) {
        console.error(`Not in "${setName}": ${missing.join(", ")}`);
        process.exit(1);
    }
    const value = command === "flag"
        ? { reason: arg("reason") ?? "Regenerated after delivery — every sentence may differ from the delivered file.", at: new Date().toISOString(), by: "set prep" }
        : null;
    for (const s of scripts) console.log(`${command === "flag" ? "flag " : "clear"} ${s.application_number} ${s.student_name} (${s.status})${s.full_listen ? " — already flagged" : ""}`);
    if (!flag("yes")) {
        console.log("Preview only. Re-run with --yes to write.");
        process.exit(0);
    }
    const { error: updateError } = await db.from("scripts").update({ full_listen: value }).in("id", scripts.map(s => s.id));
    if (updateError) throw updateError;
    console.log(`✅ ${command === "flag" ? "Flagged" : "Cleared"} ${scripts.length} script(s). Statuses untouched.`);
} else {
    console.error('Usage: full-listen.mjs list | flag|clear "<set name>" <application number>… [--reason "…"] [--yes]');
    process.exit(1);
}
