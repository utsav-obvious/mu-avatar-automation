// Client-side audio engine for /review: generates sentences via /review/api/tts, caches them in
// IndexedDB, and joins them into one WAV with the gaps validated in join-test/. Approved scripts keep
// their clips in storage, and a delivered WAV can be split back into sentences, so a fix to a
// delivered script regenerates only the changed sentence and splices it in.

import type { AudioSource, ReviewScript, Sentence } from "@/lib/review/types";

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

// Splitting a delivered WAV: the gaps this tool inserts are digital silence (exact zeros) of at least
// MIN_SILENCE; speech never has runs that long.
const SPLIT_SILENCE = 0.28;
// "Keep original length": pauses next to a patched sentence may shrink to MIN_SILENCE or grow by
// this much; whatever is left is absorbed by time-stretching the new take, at most MAX_STRETCH.
const MAX_GAP_GROWTH = 0.25;
const MAX_STRETCH = 0.06;

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

/** Identifies a clip by everything that shapes its audio — the browser cache key and the storage file name. */
export function clipKey(req: SentenceRequest): Promise<string> {
    return hash(JSON.stringify([CACHE_VERSION, req]));
}

export function scriptClipKeys(sentences: Sentence[]): Promise<string[]> {
    return Promise.all(requestsFor(sentences).map(clipKey));
}

export async function generateSentence(req: SentenceRequest): Promise<Int16Array> {
    const key = await clipKey(req);
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

// ---------- stored clips (approved scripts) ----------

const clipUrl = (scriptId: string, key: string) =>
    `/review/api/clips?script=${encodeURIComponent(scriptId)}&key=${encodeURIComponent(key)}`;

async function fetchStoredClip(scriptId: string, key: string): Promise<Int16Array> {
    const cached = await cacheGet(key);
    if (cached) return new Int16Array(cached);
    const res = await fetch(clipUrl(scriptId, key));
    if (res.status === 401) throw new AuthError("Session expired.");
    if (!res.ok) throw new Error(`Couldn't load the approved audio (${res.status}).`);
    const buffer = await res.arrayBuffer();
    await cachePut(key, buffer);
    return new Int16Array(buffer);
}

/** True when every sentence's clip was stored at approval — the script plays and patches without generating. */
export async function hasStoredAudio(script: ReviewScript): Promise<boolean> {
    if (!script.stored_clips?.length) return false;
    const stored = new Set(script.stored_clips);
    return (await scriptClipKeys(script.sentences)).every(k => stored.has(k));
}

/** The approved audio, rebuilt exactly from the stored clips (no ElevenLabs calls). */
export async function loadStoredAudio(script: ReviewScript, onProgress?: (done: number, total: number) => void): Promise<ScriptAudio> {
    const keys = await scriptClipKeys(script.sentences);
    const stored = new Set(script.stored_clips ?? []);
    if (!keys.every(k => stored.has(k))) throw new Error("The approved audio isn't stored for this script.");
    let done = 0;
    onProgress?.(0, keys.length);
    const clips = await Promise.all(keys.map(k => fetchStoredClip(script.id, k).then(pcm => {
        onProgress?.(++done, keys.length);
        return pcm;
    })));
    return joinSentences(clips, script.sentences, "stored");
}

/** Uploads the clips the server doesn't have yet. Returns every sentence's key, in order. */
export async function storeClips(scriptId: string, sentences: Sentence[], clips: (Int16Array | null)[], alreadyStored: string[]): Promise<string[]> {
    const keys = await scriptClipKeys(sentences);
    const have = new Set(alreadyStored);
    const missing = keys.map((k, i) => [k, clips[i]] as const).filter(([k]) => !have.has(k));
    for (const [key, pcm] of missing) {
        if (!pcm) throw new Error("A sentence's audio isn't available to store.");
        const res = await fetch(clipUrl(scriptId, key), {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: new Blob([pcm.slice().buffer]),
        });
        if (res.status === 401) throw new AuthError("Session expired.");
        if (!res.ok) throw new Error(`Couldn't store the audio (${res.status}).`);
    }
    return keys;
}

// ---------- trimming ----------

interface Piece {
    pcm: Int16Array; // what the sentence occupies in the file: speech plus its kept soft margins
    lead: number; // seconds kept before speech starts
    tail: number; // seconds kept after speech ends
}

// Speech = ≥ 30 ms above SPEECH_DB, so isolated clicks don't count.
function analyse(pcm: Int16Array) {
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
    return { frame, frames, db, first, last, hasSpeech: first < frames - 2 };
}

// Keep the speech plus its soft onset/decay; cut breaths, room tone and padding beyond that.
function trim(pcm: Int16Array): Piece {
    const { frame, frames, db, first, last, hasSpeech } = analyse(pcm);
    if (!hasSpeech) return { pcm, lead: 0, tail: 0 }; // no speech detected — leave untouched

    // Walk outwards through soft sound, within the min/max margins.
    let softStart = first;
    while (softStart > 0 && db[softStart - 1] > SOFT_DB && (first - softStart + 1) * 0.01 <= LEAD_MAX) softStart--;
    let softEnd = last + 1;
    while (softEnd < frames && db[softEnd] > SOFT_DB && (softEnd - last) * 0.01 <= TAIL_MAX) softEnd++;
    const speechStart = first * frame, speechEnd = (last + 1) * frame;
    const start = Math.max(0, Math.min(softStart * frame, speechStart - Math.round(LEAD_MIN * SAMPLE_RATE)));
    const end = Math.min(pcm.length, Math.max(softEnd * frame, speechEnd + Math.round(TAIL_MIN * SAMPLE_RATE)));

    const out = pcm.slice(start, end); // copy — the cached clip must stay untouched
    fadeEdges(out);
    return { pcm: out, lead: (speechStart - start) / SAMPLE_RATE, tail: (end - speechEnd) / SAMPLE_RATE };
}

function fadeEdges(pcm: Int16Array) {
    const fade = Math.min(Math.round(FADE * SAMPLE_RATE), Math.floor(pcm.length / 2));
    for (let k = 0; k < fade; k++) {
        const g = k / fade;
        pcm[k] = Math.round(pcm[k] * g);
        pcm[pcm.length - 1 - k] = Math.round(pcm[pcm.length - 1 - k] * g);
    }
}

// Margins of a piece that is already trimmed (cut from a delivered WAV).
function measure(pcm: Int16Array): Piece {
    const { frame, first, last, hasSpeech } = analyse(pcm);
    if (!hasSpeech) return { pcm, lead: 0, tail: 0 };
    return { pcm, lead: (first * frame) / SAMPLE_RATE, tail: Math.max(0, pcm.length - (last + 1) * frame) / SAMPLE_RATE };
}

// ---------- joining ----------

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
    source: AudioSource;
    clips: (Int16Array | null)[]; // raw per-sentence PCM (null = taken from a delivered WAV)
    pieces: Piece[]; // what each sentence occupies in the file
    gaps: number[]; // samples of silence before each piece (gaps[0] = silence at the start of the file)
    trailing: number; // samples of silence after the last piece
    url: string; // blob URL of the joined WAV
    blob: Blob;
    starts: number[]; // seconds, per sentence
    ends: number[];
    duration: number;
}

function assemble(source: AudioSource, clips: (Int16Array | null)[], pieces: Piece[], gaps: number[], trailing: number): ScriptAudio {
    const parts: Int16Array[] = [];
    const starts: number[] = [], ends: number[] = [];
    let n = 0;
    pieces.forEach((piece, i) => {
        if (gaps[i] > 0) parts.push(new Int16Array(gaps[i]));
        n += gaps[i];
        parts.push(piece.pcm);
        starts.push(n / SAMPLE_RATE);
        n += piece.pcm.length;
        ends.push(n / SAMPLE_RATE);
    });
    if (trailing > 0) parts.push(new Int16Array(trailing));
    n += trailing;
    const blob = wavBlob(parts);
    return { source, clips, pieces, gaps, trailing, url: URL.createObjectURL(blob), blob, starts, ends, duration: n / SAMPLE_RATE };
}

const pauseBefore = (sentences: Sentence[], i: number) =>
    sentences[i].paragraph !== sentences[i - 1].paragraph ? PAUSE_PARAGRAPH : PAUSE_SENTENCE;

// Kept margins count towards the pause, but there's always MIN_SILENCE of real silence.
const naturalGap = (prev: Piece, next: Piece, pause: number) =>
    Math.round(Math.max(MIN_SILENCE, pause - prev.tail - next.lead) * SAMPLE_RATE);

export function joinSentences(clips: Int16Array[], sentences: Sentence[], source: AudioSource = "generated"): ScriptAudio {
    const pieces = clips.map(trim);
    const gaps = pieces.map((piece, i) => (i === 0 ? 0 : naturalGap(pieces[i - 1], piece, pauseBefore(sentences, i))));
    return assemble(source, clips, pieces, gaps, 0);
}

/**
 * The script audio with sentence `index` replaced by a new raw take. Every other sentence keeps its
 * exact samples; only the two pauses around the new take are recomputed with the usual rule.
 */
export function spliceSentence(audio: ScriptAudio, index: number, clip: Int16Array, sentences: Sentence[]): ScriptAudio {
    const clips = audio.clips.map((c, i) => (i === index ? clip : c));
    if (clips.every(c => c !== null)) return joinSentences(clips as Int16Array[], sentences, audio.source);
    const pieces = audio.pieces.map((p, i) => (i === index ? trim(clip) : p));
    const gaps = [...audio.gaps];
    if (index > 0) gaps[index] = naturalGap(pieces[index - 1], pieces[index], pauseBefore(sentences, index));
    if (index + 1 < pieces.length) gaps[index + 1] = naturalGap(pieces[index], pieces[index + 1], pauseBefore(sentences, index + 1));
    return assemble(audio.source, clips, pieces, gaps, audio.trailing);
}

/** Same audio under a new blob URL — for keeping a preview after the panel that made it revokes its URL. */
export function withFreshUrl(audio: ScriptAudio): ScriptAudio {
    return { ...audio, url: URL.createObjectURL(audio.blob) };
}

// ---------- delivered WAVs ----------

/** 16-bit PCM samples of a WAV the tool downloaded (44.1 kHz mono). Throws a reviewer-readable error otherwise. */
export function parseWav(buffer: ArrayBuffer): Int16Array {
    const view = new DataView(buffer);
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    if (buffer.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("That isn't a WAV file.");
    let format: { codec: number; channels: number; rate: number; bits: number } | null = null;
    for (let o = 12; o + 8 <= buffer.byteLength;) {
        const id = tag(o), size = view.getUint32(o + 4, true), body = o + 8;
        if (id === "fmt ") {
            format = { codec: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
        } else if (id === "data") {
            if (!format) break;
            if (format.codec !== 1 || format.channels !== 1 || format.rate !== SAMPLE_RATE || format.bits !== 16) {
                throw new Error(`This WAV is ${format.rate / 1000} kHz, ${format.channels === 1 ? "mono" : `${format.channels} channels`}, ${format.bits}-bit — upload the file the review tool downloaded (44.1 kHz mono, 16-bit), not one exported from an editor.`);
            }
            const end = Math.min(buffer.byteLength, body + size);
            return new Int16Array(buffer.slice(body, end - ((end - body) % 2)));
        }
        o = body + size + (size % 2);
    }
    throw new Error("Couldn't read the audio in this WAV.");
}

/**
 * Splits a delivered WAV back into its sentences at the tool's digital-silence pauses. The result
 * reassembles to the exact same samples. Refuses a file whose pauses don't match the script.
 */
export function audioFromDelivered(pcm: Int16Array, sentences: Sentence[]): ScriptAudio {
    const minRun = Math.round(SPLIT_SILENCE * SAMPLE_RATE);
    const runs: [number, number][] = [];
    for (let i = 0; i < pcm.length;) {
        if (pcm[i] !== 0) { i++; continue; }
        let j = i;
        while (j < pcm.length && pcm[j] === 0) j++;
        if (j - i >= minRun && i > 0 && j < pcm.length) runs.push([i, j]); // interior pauses only
        i = j;
    }
    if (runs.length !== sentences.length - 1) {
        throw new Error(`This file has ${runs.length + 1} parts separated by pauses, but the script has ${sentences.length} sentences. Upload the WAV the review tool downloaded for this script, unedited.`);
    }
    const pieces: Piece[] = [], gaps: number[] = [0];
    let start = 0;
    for (const [s, e] of runs) {
        pieces.push(measure(pcm.slice(start, s)));
        gaps.push(e - s);
        start = e;
    }
    pieces.push(measure(pcm.slice(start)));
    return assemble("upload", sentences.map(() => null), pieces, gaps, 0);
}

// ---------- keep original length ----------

// WSOLA time-stretch (overlap-add with waveform-similarity search) — keeps the pitch, fine for speech
// changes of a few percent.
function stretch(input: Int16Array, outLength: number): Int16Array {
    const N = 1024, H = N / 2, TOL = 256;
    if (outLength === input.length || input.length < 2 * N) {
        const out = new Int16Array(outLength);
        out.set(input.subarray(0, Math.min(outLength, input.length)));
        return out;
    }
    const x = Float32Array.from(input);
    const ratio = (input.length - N) / Math.max(1, outLength - N);
    const acc = new Float32Array(outLength + N), norm = new Float32Array(outLength + N);
    const win = new Float32Array(N).map((_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
    let prev = 0;
    for (let k = 0; k * H < outLength; k++) {
        const nominal = Math.min(Math.round(k * H * ratio), x.length - N);
        let best = nominal;
        const natural = prev + H;
        if (k > 0 && natural + H <= x.length) {
            let bestScore = -Infinity;
            for (let d = -TOL; d <= TOL; d += 2) {
                const cand = nominal + d;
                if (cand < 0 || cand + N > x.length) continue;
                let s = 0;
                for (let j = 0; j < H; j += 2) s += x[natural + j] * x[cand + j];
                if (s > bestScore) { bestScore = s; best = cand; }
            }
        }
        const o = k * H;
        for (let j = 0; j < N; j++) {
            acc[o + j] += x[best + j] * win[j];
            norm[o + j] += win[j];
        }
        prev = best;
    }
    const out = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(acc[i] / Math.max(norm[i], 0.1))));
    fadeEdges(out);
    return out;
}

/**
 * The patched audio fitted back to the delivered length: around each run of patched sentences the
 * pauses give or take first, then the new takes are time-stretched (≤ MAX_STRETCH). Everything
 * outside the patched runs stays at its exact original position.
 */
export function fitToOriginal(base: ScriptAudio, patched: ScriptAudio, changed: number[]): { audio: ScriptAudio } | { error: string } {
    const n = base.pieces.length;
    const minGap = Math.round(MIN_SILENCE * SAMPLE_RATE), growth = Math.round(MAX_GAP_GROWTH * SAMPLE_RATE);
    const pieces = [...patched.pieces], gaps = [...patched.gaps];
    const sorted = [...new Set(changed)].sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const i of sorted) {
        const last = runs[runs.length - 1];
        if (last && last[1] === i - 1) last[1] = i;
        else runs.push([i, i]);
    }
    for (const [a, b] of runs) {
        // The pauses that belong to this run: before it, between its sentences, after it.
        const gapIdx = [...(a > 0 ? [a] : []), ...Array.from({ length: b - a }, (_, k) => a + 1 + k), ...(b + 1 < n ? [b + 1] : [])];
        const span = (audio: ScriptAudio) => gapIdx.reduce((s, g) => s + audio.gaps[g], 0)
            + audio.pieces.slice(a, b + 1).reduce((s, p) => s + p.pcm.length, 0);
        let excess = span(patched) - span(base); // samples to remove (negative = to add)

        // 1. Pauses: shrink towards MIN_SILENCE or grow by up to MAX_GAP_GROWTH, spread evenly.
        for (let pass = 0; pass < 4 && excess !== 0 && gapIdx.length; pass++) {
            const room = gapIdx.map(g => (excess > 0 ? gaps[g] - minGap : patched.gaps[g] + growth - gaps[g]));
            const open = room.filter(r => r > 0).length;
            if (!open) break;
            const share = Math.ceil(Math.abs(excess) / open);
            gapIdx.forEach((g, k) => {
                if (room[k] <= 0 || excess === 0) return;
                const step = Math.min(room[k], share, Math.abs(excess));
                gaps[g] += excess > 0 ? -step : step;
                excess += excess > 0 ? -step : step;
            });
        }
        if (excess === 0) continue;

        // 2. Time-stretch the run's new takes by one factor; rounding goes to the last of them.
        const total = pieces.slice(a, b + 1).reduce((s, p) => s + p.pcm.length, 0);
        const factor = (total - excess) / total;
        if (Math.abs(1 - factor) > MAX_STRETCH) {
            const which = a === b ? `Sentence ${a + 1}` : `Sentences ${a + 1}–${b + 1}`;
            return { error: `${which}: the new take is ${Math.round(Math.abs(1 - factor) * 100)}% ${excess > 0 ? "longer" : "shorter"} than the original even with the pauses adjusted — try another take, or download at natural length.` };
        }
        let left = total - excess;
        for (let i = a; i <= b; i++) {
            const len = i === b ? left : Math.round(pieces[i].pcm.length * factor);
            left -= len;
            const pcm = stretch(pieces[i].pcm, len);
            pieces[i] = { pcm, lead: pieces[i].lead * factor, tail: pieces[i].tail * factor };
        }
    }
    const audio = assemble(patched.source, patched.clips, pieces, gaps, patched.trailing);
    const drift = Math.abs(audio.duration - base.duration) * SAMPLE_RATE;
    if (drift > 1) {
        URL.revokeObjectURL(audio.url);
        return { error: "Couldn't keep the original length — download at natural length." };
    }
    return { audio };
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
    // A reopened script reuses the clips stored at approval; only changed sentences are generated.
    const stored = new Set(script.stored_clips ?? []);
    const clipFor = async (req: SentenceRequest) => {
        if (stored.size) {
            const key = await clipKey(req);
            if (stored.has(key)) return fetchStoredClip(script.id, key).catch(() => generateSentence(req));
        }
        return generateSentence(req);
    };
    const promise = Promise.all(
        requestsFor(script.sentences).map(req =>
            clipFor(req).then(pcm => {
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
