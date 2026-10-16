"use server";

import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { db, isAuthed, passcodeMatches, sessionToken, SESSION_COOKIE } from "@/lib/review/server";
import type { ChangeLogEntry, ScriptStatus, Sentence, SpellingOption } from "@/lib/review/types";

async function requireAuth() {
    if (!(await isAuthed())) throw new Error("Not signed in.");
}

export type LoginState = { ok: boolean; error?: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
    const passcode = String(formData.get("passcode") ?? "");
    if (!passcodeMatches(passcode)) return { ok: false, error: "Wrong passcode." };
    (await cookies()).set(SESSION_COOKIE, sessionToken(passcode), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/review",
        maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
}

// Opening a pending script moves it to "in_review". Returns the script's current status.
export async function markInReview(scriptId: string): Promise<ScriptStatus> {
    await requireAuth();
    const { data, error } = await db()
        .from("scripts")
        .update({ status: "in_review", updated_at: new Date().toISOString() })
        .eq("id", scriptId)
        .eq("status", "pending")
        .select("status");
    if (error) throw error;
    if (data.length) return "in_review";
    const { data: current, error: readError } = await db().from("scripts").select("status").eq("id", scriptId).single();
    if (readError) throw readError;
    return current.status as ScriptStatus;
}

const isSentence = (s: unknown): s is Sentence => {
    const x = s as Sentence;
    return typeof x?.original === "string" && typeof x.spoken === "string" && x.spoken.trim() !== ""
        && Number.isInteger(x.paragraph) && Number.isInteger(x.seed)
        && (x.prev_context === undefined || typeof x.prev_context === "string")
        && (x.next_context === undefined || typeof x.next_context === "string");
};

export async function saveSentences(scriptId: string, sentences: Sentence[]): Promise<void> {
    await requireAuth();
    if (!Array.isArray(sentences) || !sentences.length || !sentences.every(isSentence)) {
        throw new Error("Invalid sentences.");
    }
    const { error } = await db()
        .from("scripts")
        .update({ sentences, updated_at: new Date().toISOString() })
        .eq("id", scriptId);
    if (error) throw error;
}

export async function saveLibraryEntry(entry: { term: string; spoken: string; scriptId: string }): Promise<void> {
    await requireAuth();
    const term = entry.term.trim(), spoken = entry.spoken.trim();
    if (!term || !spoken) throw new Error("Term and spelling are required.");
    const { error } = await db().from("pronunciation_library").upsert(
        { term, spoken, source_script_id: entry.scriptId, updated_at: new Date().toISOString() },
        { onConflict: "term" }
    );
    if (error) throw error;
}

// Fallback for words without prepared options (names/acronyms get theirs offline with the set).
// Claude Opus 5.5 at low effort: best transliteration quality, and at a few calls per set the
// cost is a fraction of a cent per call. Options follow what worked best on multilingual_v2 in
// candidate-grid/: Devanagari first, then the original spelling, letters for acronyms, respellings.
const SUGGEST_MODEL = "claude-opus-5-5";

const SPELLING_SCHEMA = {
    type: "object",
    properties: {
        options: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    text: { type: "string" },
                    label: { type: "string", enum: ["Devanagari", "Original", "Letters", "Number", "Respelling"] },
                },
                required: ["text", "label"],
                additionalProperties: false,
            },
        },
    },
    required: ["options"],
    additionalProperties: false,
};

export async function suggestSpellings(selected: string, originalSentence: string): Promise<SpellingOption[]> {
    await requireAuth();
    const apiKey = process.env.CLAUDEAPI_KEY;
    if (!apiKey) throw new Error("Claude is not configured.");
    if (!selected.trim() || selected.length > 200) throw new Error("Select a word or name first.");

    const client = new Anthropic({ apiKey });
    let response: Anthropic.Beta.BetaMessage;
    try {
        response = await client.beta.messages.create({
            model: SUGGEST_MODEL,
            max_tokens: 4096,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default", // a declined request is retried on Anthropic's recommended model
            output_config: {
                effort: "low",
                format: { type: "json_schema", schema: SPELLING_SCHEMA },
            },
            system: "You help fix how an ElevenLabs multilingual v2 text-to-speech voice pronounces words in personalised admission messages for an Indian business school. Suggest spellings that make the voice say the word the way an Indian speaker would.",
            messages: [{
                role: "user",
                content: `The voice mispronounces "${selected}" in this sentence:
"${originalSentence}"

Give 3–5 distinct spellings to try, best first:
- Indian name, place or institution: first a Devanagari spelling (e.g. "Vidhi" → "विधि"); this works best with this voice.
- Acronym read letter by letter: letters separated by spaces (e.g. "KIIT" → "K I I T"), plus the spoken-word form if that is common.
- Number: how it should be read aloud (e.g. "94.67" → "94 point 6 7").
- The plain English spelling, if "${selected}" is not already in Latin script.
- 1–2 simple English respellings (e.g. "Utkarsh" → "Ut-kursh").
Never repeat "${selected}" itself.`,
            }],
        });
    } catch (err) {
        if (err instanceof Anthropic.RateLimitError) throw new Error("Claude is busy — try again in a moment.");
        if (err instanceof Anthropic.APIError) throw new Error(`Claude request failed (${err.status ?? "network"}).`);
        throw err;
    }

    if (response.stop_reason === "refusal") throw new Error("Claude declined this request — edit the text directly.");
    const text = response.content.find(b => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as { options?: SpellingOption[] };
    return (parsed.options ?? [])
        .filter(o => o.text.trim() && o.text.trim() !== selected.trim())
        .map(o => ({ text: o.text.trim(), label: o.label }))
        .slice(0, 5);
}

// Approve (or reopen) a script. Approving records the time; reopening clears it.
export async function setScriptStatus(scriptId: string, status: "approved" | "in_review"): Promise<void> {
    await requireAuth();
    if (status !== "approved" && status !== "in_review") throw new Error("Invalid status.");
    const now = new Date().toISOString();
    const { error } = await db()
        .from("scripts")
        .update({ status, approved_at: status === "approved" ? now : null, updated_at: now })
        .eq("id", scriptId);
    if (error) throw error;
}

const CHANGE_ACTIONS = new Set(["take", "fix", "edit", "delete", "undo"]);
const TEXT_FIELDS = ["before_original", "before_spoken", "after_original", "after_spoken", "library_term", "library_spoken"] as const;

// Append reviewer actions to the change log. Never blocks the reviewer: callers fire and forget.
export async function logChanges(entries: ChangeLogEntry[]): Promise<void> {
    await requireAuth();
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 50) throw new Error("Invalid log entries.");
    const rows = entries.map(e => {
        if (!CHANGE_ACTIONS.has(e.action) || typeof e.script_id !== "string" || typeof e.application_number !== "string") {
            throw new Error("Invalid log entry.");
        }
        const row: Record<string, unknown> = {
            set_id: e.set_id,
            set_name: String(e.set_name ?? "").slice(0, 200),
            script_id: e.script_id,
            application_number: e.application_number.slice(0, 100),
            sentence_index: Number.isInteger(e.sentence_index) ? e.sentence_index : null,
            action: e.action,
            take_id: typeof e.take_id === "string" ? e.take_id : null,
            seed: Number.isInteger(e.seed) ? e.seed : null,
            reviewer: String(e.reviewer ?? "").slice(0, 100) || "unknown",
        };
        for (const f of TEXT_FIELDS) row[f] = typeof e[f] === "string" ? (e[f] as string).slice(0, 5000) : null;
        return row;
    });
    const { error } = await db().from("sentence_changes").insert(rows);
    if (error) throw error;
}
