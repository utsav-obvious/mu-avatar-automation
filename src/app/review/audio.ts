// Client-side audio engine for /review: generates sentences via /review/api/tts, caches them in
// IndexedDB, and joins them into one WAV with the gaps validated in join-test/.

import type { ReviewScript, Sentence } from "@/lib/review/types";

export const SAMPLE_RATE = 44100;
// Pause from the end of one sentence's speech to the start of the next (breaths count as silence).
// Measured on the join tests: the old fixed gaps (0.45 s / 0.8 s) plus untrimmed breaths and tails
// came out at 0.55–0.65 s and 0.9–1.06 s, which sounded too long.
const PAUSE_SENTENCE = 0.5;
const PAUSE_PARAGRAPH = 0.6;
const MIN_SILENCE = 0.3; // never less true silence than this before a sentence starts
const SPEECH_DB = -35; // 10 ms frames quieter than this are not "speech" (breaths, room tone)
const SOFT_DB = -55; // …but soft onsets/decays above this are kept, within the limits below
const LEAD_MIN = 0.03, LEAD_MAX = 0.15; // kept before speech: soft "h"/"s"/inhale onsets
const TAIL_MIN = 0.08, TAIL_MAX = 0.12; // kept after speech, so word endings aren't clipped
const FADE = 0.008; // fade at each cut so no sentence starts or ends with a click
const MAX_CONCURRENT = 5; // per browser; the ElevenLabs plan allows 15 across all reviewers
const CACHE_VERSION = "mlv2-pcm44100-v1"; // bump if model/voice/settings change

export class AuthError extends Error {}

// ---------- concurrency ----------

let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
    if (active < MAX_CONCURRENT) { active++; return; }
    await new Promise<void>(resolve => waiting.push(resolve));
}
function release() {
    const next = waiting.shift();
    if (next) next();
    else active--;
}

// ---------- IndexedDB cache (best effort — the page works without it) ----------

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
    dbPromise ??= new Promise(resolve => {
        try {
            const req = indexedDB.open("review-audio", 1);
            req.onupgradeneeded = () => req.result.createObjectStore("clips");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
}

async function cacheGet(key: string): Promise<ArrayBuffer | null> {
    const db = await openDb();
    if (!db) return null;
    return new Promise(resolve => {
        try {
            const req = db.transaction("clips").objectStore("clips").get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function cachePut(key: string, value: ArrayBuffer) {
    const db = await openDb();
    if (!db) return;
    try {
        db.transaction("clips", "readwrite").objectStore("clips").put(value, key);
    } catch {
        // quota or private mode — ignore
    }
}

async function hash(input: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// ---------- generation ----------

export interface SentenceRequest {
    text: string;
    previousText?: string;
    nextText?: string;
    seed: number;
}

export function requestsFor(sentences: Sentence[]): SentenceRequest[] {
    return sentences.map((s, i) => ({
        text: s.spoken,
        previousText: s.prev_context ?? sentences[i - 1]?.spoken,
        nextText: s.next_context ?? sentences[i + 1]?.spoken,
        seed: s.seed,
    }));
}

export async function generateSentence(req: SentenceRequest): Promise<Int16Array> {
    const key = await hash(JSON.stringify([CACHE_VERSION, req]));
    const cached = await cacheGet(key);
    if (cached) return new Int16Array(cached);

    await acquire();
    try {
        for (let attempt = 0; ; attempt++) {
            const res = await fetch("/review/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req),
            });
            if (res.status === 401) throw new AuthError("Session expired.");
            if (res.status === 429 && attempt < 6) {
                await new Promise(r => setTimeout(r, 600 * 2 ** attempt + Math.random() * 400));
                continue;
            }
            if (!res.ok) throw new Error(`Audio generation failed (${res.status}).`);
            const buffer = await res.arrayBuffer();
            await cachePut(key, buffer);
            return new Int16Array(buffer);
        }
    } finally {
        release();
    }
}

// ---------- joining ----------

interface Trimmed {
    pcm: Int16Array;
    lead: number; // seconds kept before speech starts
    tail: number; // seconds kept after speech ends
}

// Keep the speech plus its soft onset/decay; cut breaths, room tone and padding beyond that.
// Speech = ≥ 30 ms above SPEECH_DB, so isolated clicks don't count.
function trim(pcm: Int16Array): Trimmed {
    const frame = Math.round(0.01 * SAMPLE_RATE);
    const frames = Math.floor(pcm.length / frame);
    const db: number[] = [];
    for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let j = f * frame; j < (f + 1) * frame; j++) sum += pcm[j] * pcm[j];
        const rms = Math.sqrt(sum / frame) / 32768;
        db.push(rms > 0 ? 20 * Math.log10(rms) : -120);
    }
    const isSpeech = (f: number) => db[f] > SPEECH_DB && db[f + 1] > SPEECH_DB && db[f + 2] > SPEECH_DB;
    let first = 0, last = frames - 1;
    while (first < frames - 2 && !isSpeech(first)) first++;
    while (last > first + 2 && !isSpeech(last - 2)) last--;
    if (first >= frames - 2) return { pcm, lead: 0, tail: 0 }; // no speech detected — leave untouched

    // Walk outwards through soft sound, within the min/max margins.
    let softStart = first;
    while (softStart > 0 && db[softStart - 1] > SOFT_DB && (first - softStart + 1) * 0.01 <= LEAD_MAX) softStart--;
    let softEnd = last + 1;
    while (softEnd < frames && db[softEnd] > SOFT_DB && (softEnd - last) * 0.01 <= TAIL_MAX) softEnd++;
    const speechStart = first * frame, speechEnd = (last + 1) * frame;
    const start = Math.max(0, Math.min(softStart * frame, speechStart - Math.round(LEAD_MIN * SAMPLE_RATE)));
    const end = Math.min(pcm.length, Math.max(softEnd * frame, speechEnd + Math.round(TAIL_MIN * SAMPLE_RATE)));

    const out = pcm.slice(start, end); // copy — the cached clip must stay untouched
    const fade = Math.min(Math.round(FADE * SAMPLE_RATE), Math.floor(out.length / 2));
    for (let k = 0; k < fade; k++) {
        const g = k / fade;
        out[k] = Math.round(out[k] * g);
        out[out.length - 1 - k] = Math.round(out[out.length - 1 - k] * g);
    }
    return { pcm: out, lead: (speechStart - start) / SAMPLE_RATE, tail: (end - speechEnd) / SAMPLE_RATE };
}

function wavBlob(parts: Int16Array[]): Blob {
    const length = parts.reduce((n, p) => n + p.length, 0);
    const header = new DataView(new ArrayBuffer(44));
    const str = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); header.setUint32(4, 36 + length * 2, true); str(8, "WAVE");
    str(12, "fmt "); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
    header.setUint32(24, SAMPLE_RATE, true); header.setUint32(28, SAMPLE_RATE * 2, true);
    header.setUint16(32, 2, true); header.setUint16(34, 16, true);
    str(36, "data"); header.setUint32(40, length * 2, true);
    return new Blob([header.buffer, ...parts.map(p => p.slice().buffer)], { type: "audio/wav" });
}

export interface ScriptAudio {
    clips: Int16Array[]; // raw per-sentence PCM, kept for in-place previews of a fix
    url: string; // blob URL of the joined WAV
    blob: Blob;
    starts: number[]; // seconds, per sentence
    ends: number[];
    duration: number;
}

export function joinSentences(clips: Int16Array[], sentences: Sentence[]): ScriptAudio {
    const parts: Int16Array[] = [];
    const starts: number[] = [], ends: number[] = [];
    let t = 0;
    const trimmed = clips.map(trim);
    trimmed.forEach((clip, i) => {
        if (i > 0) {
            // Kept margins count towards the pause, but there's always MIN_SILENCE of real silence.
            const pause = sentences[i].paragraph !== sentences[i - 1].paragraph ? PAUSE_PARAGRAPH : PAUSE_SENTENCE;
            const gap = Math.max(MIN_SILENCE, pause - trimmed[i - 1].tail - clip.lead);
            parts.push(new Int16Array(Math.round(gap * SAMPLE_RATE)));
            t += gap;
        }
        parts.push(clip.pcm);
        starts.push(t);
        t += clip.pcm.length / SAMPLE_RATE;
        ends.push(t);
    });
    const blob = wavBlob(parts);
    return { clips, url: URL.createObjectURL(blob), blob, starts, ends, duration: t };
}

// ---------- per-script loading with a small in-memory LRU of joined WAVs ----------

const MEMORY_LIMIT = 4;
const loaded = new Map<string, Promise<ScriptAudio>>();

const scriptKey = (script: ReviewScript) => `${script.id}:${JSON.stringify(script.sentences.map(s => [s.spoken, s.seed]))}`;

export function isLoaded(script: ReviewScript): boolean {
    return loaded.has(scriptKey(script));
}

export function loadScriptAudio(script: ReviewScript, onProgress?: (done: number, total: number) => void): Promise<ScriptAudio> {
    const key = scriptKey(script);
    const existing = loaded.get(key);
    if (existing) {
        loaded.delete(key);
        loaded.set(key, existing); // mark as recently used
        existing.then(() => onProgress?.(script.sentences.length, script.sentences.length)).catch(() => {});
        return existing;
    }

    let done = 0;
    const total = script.sentences.length;
    onProgress?.(0, total);
    const promise = Promise.all(
        requestsFor(script.sentences).map(req =>
            generateSentence(req).then(pcm => {
                onProgress?.(++done, total);
                return pcm;
            })
        )
    ).then(clips => joinSentences(clips, script.sentences));

    promise.catch(() => loaded.delete(key)); // let a retry start fresh
    loaded.set(key, promise);
    while (loaded.size > MEMORY_LIMIT) {
        const [oldestKey, oldest] = loaded.entries().next().value!;
        loaded.delete(oldestKey);
        oldest.then(a => URL.revokeObjectURL(a.url)).catch(() => {});
    }
    return promise;
}
