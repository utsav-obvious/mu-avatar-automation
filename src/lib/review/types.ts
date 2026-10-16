export type ScriptStatus = "pending" | "in_review" | "approved";

export interface Sentence {
    original: string; // as written in the CSV — what reviewers read
    spoken: string; // what is sent to ElevenLabs (Devanagari names, digit-by-digit decimals…)
    paragraph: number;
    seed: number;
    // Set when a neighbour is fixed: the context this sentence's audio was generated with, so
    // reloading reproduces the exact take the reviewer heard instead of regenerating it.
    prev_context?: string;
    next_context?: string;
}

export interface LibraryEntry {
    term: string; // as written in scripts
    spoken: string; // what to send to ElevenLabs
}

export interface SpellingOption {
    text: string;
    label: string; // e.g. "Devanagari", "Original", "Respelling"
}

export interface ReviewSet {
    id: string;
    name: string;
    file_prefix: string;
}

export interface ReviewScript {
    id: string;
    set_id: string;
    position: number;
    application_number: string;
    student_name: string;
    status: ScriptStatus;
    approved_at: string | null;
    sentences: Sentence[];
    nouns: NounOptions[];
    stored_clips: string[]; // keys of the approved clips kept in storage (audio.ts clipKey)
    feedback: ClientFeedback | null;
    patches: PatchRecord[];
}

// Client comments on a delivered script, imported offline (review-tool/cli/import-feedback.mjs) with
// the suggested sentence fixes already written in the current spoken rules.
export interface ClientFeedback {
    comment: string;
    no_regen: boolean; // QC'd and decided not to fix
    source: string; // the comments CSV
    imported_at: string;
    suggestions: FeedbackSuggestion[];
}

export interface FeedbackSuggestion {
    index: number; // 0-based sentence index
    original: string;
    spoken: string;
    note: string;
}

// generated = ElevenLabs / browser cache, stored = clips saved at approval, upload = the delivered WAV
export type AudioSource = "generated" | "stored" | "upload";

// One patched download of an approved script. Patched scripts stay approved.
export interface PatchRecord {
    at: string;
    by: string;
    sentences: number[]; // 0-based indexes that were replaced
    length: "natural" | "original";
    source: AudioSource; // where the untouched sentences came from
    file: string;
}

// Prepared offline with the set: one-click spelling options for each name/acronym in the script.
export interface NounOptions {
    term: string; // as written in the script
    kind: string | null;
    options: SpellingOption[]; // first = default spelling sent at upload time
}

export type ChangeAction = "take" | "fix" | "edit" | "delete" | "undo";

// One row of the append-only reviewer change log (sentence_changes). A take counts as kept when
// a fix/edit row references its take_id.
export interface ChangeLogEntry {
    set_id: string;
    set_name: string;
    script_id: string;
    application_number: string;
    sentence_index: number | null;
    action: ChangeAction;
    before_original?: string | null;
    before_spoken?: string | null;
    after_original?: string | null;
    after_spoken?: string | null;
    take_id?: string | null;
    seed?: number | null;
    library_term?: string | null;
    library_spoken?: string | null;
    reviewer: string;
}
