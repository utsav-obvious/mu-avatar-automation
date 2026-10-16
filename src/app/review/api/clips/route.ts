import { AUDIO_BUCKET, CLIP_KEY, UUID, clipPath, db, isAuthed } from "@/lib/review/server";

// Approved sentence clips in the private "review-audio" bucket. Clips go through this route (not
// signed URLs) so the bucket stays reachable only with the server's key. One sentence is well under
// Vercel's 4.5 MB request limit (a 20 s sentence ≈ 1.8 MB of raw PCM).
//   GET /review/api/clips?script=<id>&key=<clip key>   → raw 16-bit 44.1 kHz mono PCM
//   PUT /review/api/clips?script=<id>&key=<clip key>   ← same

const MAX_BYTES = 4 * 1024 * 1024;

function target(req: Request): string | null {
    const params = new URL(req.url).searchParams;
    const script = params.get("script") ?? "", key = params.get("key") ?? "";
    return UUID.test(script) && CLIP_KEY.test(key) ? clipPath(script, key) : null;
}

export async function GET(req: Request) {
    if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });
    const path = target(req);
    if (!path) return new Response("Invalid clip.", { status: 400 });
    const { data, error } = await db().storage.from(AUDIO_BUCKET).download(path);
    if (error || !data) return new Response("Clip not found.", { status: 404 });
    return new Response(data, {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=86400" },
    });
}

export async function PUT(req: Request) {
    if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });
    const path = target(req);
    if (!path) return new Response("Invalid clip.", { status: 400 });
    const body = await req.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES || body.byteLength % 2) {
        return new Response("Invalid clip size.", { status: 400 });
    }
    const { error } = await db().storage.from(AUDIO_BUCKET)
        .upload(path, body, { contentType: "application/octet-stream", upsert: true });
    if (error) {
        console.error(`Clip upload failed: ${error.message}`);
        return new Response("Upload failed.", { status: 502 });
    }
    return new Response(null, { status: 204 });
}
