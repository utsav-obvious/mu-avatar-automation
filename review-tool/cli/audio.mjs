// Stored approved audio (private Storage bucket "review-audio") — check usage, delete a finished set.
// Supabase Free includes 1 GB of storage (≈ 6 MB per script), so purge each set once its videos are done.
//
//   node review-tool/cli/audio.mjs usage                         # MB per set
//   node review-tool/cli/audio.mjs purge "C8 R1 – Set 2"         # preview what would be deleted
//   node review-tool/cli/audio.mjs purge "C8 R1 – Set 2" --yes   # delete (ask the user first)
//
// Purging only removes audio: text, statuses and patches stay. Patching a purged script later needs its WAV.

import { supabase, flag } from "./common.mjs";

const BUCKET = "review-audio";
const [command, setName] = process.argv.slice(2);
const db = supabase();
const bucket = db.storage.from(BUCKET);

async function objectsOf(scriptId) {
    const { data, error } = await bucket.list(scriptId, { limit: 1000 });
    if (error) throw error;
    return data.map(o => ({ path: `${scriptId}/${o.name}`, bytes: o.metadata?.size ?? 0 }));
}

const mb = bytes => (bytes / 1024 / 1024).toFixed(1);

const { data: sets, error: setsError } = await db.from("sets").select("id, name").order("created_at");
if (setsError) throw setsError;

if (command === "usage") {
    let total = 0;
    for (const set of sets) {
        const { data: scripts, error } = await db.from("scripts").select("id").eq("set_id", set.id);
        if (error) throw error;
        let bytes = 0, files = 0, withAudio = 0;
        for (const s of scripts) {
            const objects = await objectsOf(s.id);
            if (objects.length) withAudio++;
            files += objects.length;
            bytes += objects.reduce((n, o) => n + o.bytes, 0);
        }
        total += bytes;
        console.log(`${set.name.padEnd(24)} ${String(withAudio).padStart(3)}/${scripts.length} scripts  ${String(files).padStart(4)} clips  ${mb(bytes).padStart(7)} MB`);
    }
    console.log(`\nTotal ${mb(total)} MB of the free plan's 1024 MB.`);
} else if (command === "purge" && setName) {
    const set = sets.find(s => s.name === setName);
    if (!set) {
        console.error(`Set "${setName}" not found. Sets: ${sets.map(s => s.name).join(", ")}`);
        process.exit(1);
    }
    const { data: scripts, error } = await db.from("scripts").select("id, application_number").eq("set_id", set.id);
    if (error) throw error;
    const objects = (await Promise.all(scripts.map(s => objectsOf(s.id)))).flat();
    console.log(`"${set.name}": ${objects.length} clips, ${mb(objects.reduce((n, o) => n + o.bytes, 0))} MB in ${scripts.length} scripts.`);
    if (!flag("yes")) {
        console.log("Preview only. Re-run with --yes to delete them (text, statuses and patches stay).");
        process.exit(0);
    }
    for (let i = 0; i < objects.length; i += 100) {
        const { error: removeError } = await bucket.remove(objects.slice(i, i + 100).map(o => o.path));
        if (removeError) throw removeError;
    }
    const { error: updateError } = await db.from("scripts").update({ stored_clips: [] }).eq("set_id", set.id);
    if (updateError) throw updateError;
    console.log(`✅ Deleted ${objects.length} clips; "${set.name}" now patches from uploaded WAVs only.`);
} else {
    console.error('Usage: audio.mjs usage | purge "<set name>" [--yes]');
    process.exit(1);
}
