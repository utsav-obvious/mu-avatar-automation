import { isAuthed } from "@/lib/review/server";

// One sentence → raw 16-bit mono PCM at 44.1 kHz from eleven_multilingual_v2.
// Neighbour sentences are passed as context so separately generated sentences join seamlessly
// (validated in join-test/: parallel generation with previous/next text was indistinguishable).

export const maxDuration = 60;

const MODEL = "eleven_multilingual_v2";
const MAX_CHARS = 2000;

export async function POST(req: Request) {
    if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });

    const apiKey = process.env.ELEVEN_LABS_API_KEY;
    const voiceId = process.env.ELEVEN_LABS_VOICE_ID;
    if (!apiKey || !voiceId) return new Response("ElevenLabs is not configured.", { status: 500 });

    const { text, previousText, nextText, seed } = await req.json().catch(() => ({}));
    if (typeof text !== "string" || !text.trim() || text.length > MAX_CHARS) {
        return new Response("Invalid text.", { status: 400 });
    }

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_44100`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
            text,
            model_id: MODEL,
            seed: Number.isInteger(seed) ? seed : 42,
            previous_text: typeof previousText === "string" ? previousText : undefined,
            next_text: typeof nextText === "string" ? nextText : undefined,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });

    if (!res.ok) {
        const detail = await res.text();
        console.error(`ElevenLabs ${res.status}: ${detail}`);
        // 429 = concurrency/rate limit; the client backs off and retries.
        return new Response(detail, { status: res.status === 429 ? 429 : 502 });
    }

    return new Response(res.body, {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
}
