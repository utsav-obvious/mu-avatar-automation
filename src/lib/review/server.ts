import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { LibraryEntry, ReviewScript, ReviewSet } from "./types";

// Server-only helpers for the /review tool. Never import from client components.

export const SESSION_COOKIE = "review_session";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
    if (!client) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SECRET_KEY;
        if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
        client = createClient(url, key, { auth: { persistSession: false } });
    }
    return client;
}

// The cookie holds a hash of the passcode, so changing REVIEW_PASSCODE logs everyone out.
export function sessionToken(passcode: string): string {
    return createHash("sha256").update(`review:${passcode}`).digest("hex");
}

export function passcodeMatches(input: string): boolean {
    const expected = process.env.REVIEW_PASSCODE;
    if (!expected) return false;
    const a = Buffer.from(sessionToken(input));
    const b = Buffer.from(sessionToken(expected));
    return timingSafeEqual(a, b);
}

export async function isAuthed(): Promise<boolean> {
    const expected = process.env.REVIEW_PASSCODE;
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!expected || !token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(sessionToken(expected));
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function loadReviewData(): Promise<{ sets: ReviewSet[]; scripts: ReviewScript[]; library: LibraryEntry[] }> {
    const [sets, scripts, library] = await Promise.all([
        db().from("sets").select("id, name, file_prefix").order("created_at"),
        db().from("scripts")
            .select("id, set_id, position, application_number, student_name, status, approved_at, sentences, nouns")
            .order("position"),
        db().from("pronunciation_library").select("term, spoken").order("term"),
    ]);
    if (sets.error) throw sets.error;
    if (scripts.error) throw scripts.error;
    if (library.error) throw library.error;
    return { sets: sets.data, scripts: scripts.data as ReviewScript[], library: library.data };
}
