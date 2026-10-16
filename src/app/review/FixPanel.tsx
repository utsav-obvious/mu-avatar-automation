"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BookPlus, Check, Loader2, Play, Sparkles, Square, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryEntry, NounOptions, ReviewScript, Sentence, SpellingOption } from "@/lib/review/types";
import { suggestSpellings } from "./actions";
import { AuthError, generateSentence, requestsFor, spliceSentence, type ScriptAudio } from "./audio";
import { isNumberEntry, toSpoken as applyTextRules } from "@/lib/review/spoken-rules.mjs";

interface Take {
    id: string; // logged with the attempt; the kept one is referenced by the fix/edit log row
    seed: number;
    sentences: Sentence[];
    preview: ScriptAudio;
}

export interface TakeInfo {
    takeId: string;
    seed: number;
    before: Sentence;
    after: Sentence;
}

const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRegex = (s: string, flags = "u") => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegex(s)}(?![\\p{L}\\p{M}\\p{N}])`, flags);

// Which of a noun's spellings is currently in the text (longest first, so "B Com" beats "B").
function currentOption(noun: NounOptions, text: string): SpellingOption | null {
    const byLength = [...noun.options].sort((a, b) => b.text.length - a.text.length);
    return byLength.find(o => wordRegex(o.text).test(text)) ?? null;
}

// New sentence list for a fix of sentence `index`. Neighbours keep the exact context their current
// audio was generated with, so they hit the cache and stay identical to what the reviewer heard.
function buildCandidate(sentences: Sentence[], index: number, original: string, spoken: string, seed: number): Sentence[] {
    const old = requestsFor(sentences);
    return sentences.map((s, i) => {
        if (i === index) return { original, spoken, paragraph: s.paragraph, seed };
        if (i === index - 1) return { ...s, next_context: old[i].nextText };
        if (i === index + 1) return { ...s, prev_context: old[i].previousText };
        return s;
    });
}

// Text to send for edited wording: names get the spelling currently used in this sentence (else the
// library / prepared default), then the shared rules (numbers as words, Devanagari lead-ins) — the
// same rules set preparation uses.
function toSpoken(text: string, nouns: NounOptions[], library: LibraryEntry[], previousSpoken: string): string {
    const choices = new Map<string, string>(library.filter(e => !isNumberEntry(e.term)).map(e => [e.term, e.spoken]));
    for (const n of nouns) choices.set(n.term, currentOption(n, previousSpoken)?.text ?? n.options[0]?.text ?? n.term);
    return applyTextRules(text, choices).spoken;
}

export default function FixPanel({
    mode,
    script,
    index,
    audio,
    library,
    initial,
    pauseMain,
    onTake,
    onKeep,
    onClose,
    onAuthError,
}: {
    mode: "fix" | "edit"; // fix = pronunciation of the same words; edit = change the wording itself
    script: ReviewScript;
    index: number;
    audio: ScriptAudio;
    library: LibraryEntry[];
    initial?: { original: string; spoken: string } | null; // prefilled text, e.g. a client-feedback suggestion
    pauseMain: () => void;
    onTake: (take: TakeInfo) => void;
    onKeep: (sentences: Sentence[], libraryEntry: LibraryEntry | null, take: TakeInfo, preview: ScriptAudio) => Promise<void>;
    onClose: () => void;
    onAuthError: () => void;
}) {
    const sentence = script.sentences[index];
    const [wording, setWording] = useState(mode === "edit" ? initial?.original ?? sentence.original : sentence.original);
    const [text, setText] = useState(initial?.spoken ?? sentence.spoken);
    const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
    const [options, setOptions] = useState<SpellingOption[] | null>(null);
    const [suggesting, setSuggesting] = useState(false);
    const [take, setTake] = useState<Take | null>(null);
    const [generating, setGenerating] = useState(false);
    const [keeping, setKeeping] = useState(false);
    const [saveToLibrary, setSaveToLibrary] = useState(false);
    const [libTerm, setLibTerm] = useState("");
    const [libSpoken, setLibSpoken] = useState("");
    const [playingWhich, setPlayingWhich] = useState<"new" | "current" | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const playerRef = useRef<HTMLAudioElement | null>(null);
    const stopRef = useRef<() => void>(() => {});

    // The selected word; if nothing is selected, the word under the caret.
    const selected = useMemo(() => {
        if (!selection) return null;
        let { start, end } = selection;
        if (start === end) {
            while (start > 0 && !/\s/.test(text[start - 1])) start--;
            while (end < text.length && !/\s/.test(text[end])) end++;
        }
        const raw = text.slice(start, end);
        const lead = raw.length - raw.trimStart().length;
        const word = raw.trim().replace(/[,.!?;:’'"()]+$/, "");
        if (!word) return null;
        return { start: start + lead, end: start + lead + word.length, word };
    }, [selection, text]);

    const libraryOptions = useMemo<SpellingOption[]>(() => {
        if (!selected) return [];
        const w = selected.word.toLowerCase();
        return library.flatMap(e => {
            if (e.term.toLowerCase() === w && e.spoken !== selected.word) return [{ text: e.spoken, label: "Library" }];
            if (e.spoken.toLowerCase() === w && e.term !== selected.word) return [{ text: e.term, label: "Original" }];
            return [];
        });
    }, [selected, library]);

    // Best guess at how the word is written in the script, for the library entry.
    const inferTerm = (from: string) => {
        const entry = library.find(e => e.spoken === from);
        if (entry) return entry.term;
        if (!hasDevanagari(from)) return from;
        const rewritten = sentence.original.split(/\s+/)
            .map(w => w.replace(/[,.!?;:’'"()]+$/, ""))
            .filter(w => /^[A-Z]/.test(w) && !sentence.spoken.includes(w));
        return rewritten.join(" ");
    };

    // Free each preview WAV when it's replaced; stop playback when the panel closes.
    useEffect(() => () => { if (take) URL.revokeObjectURL(take.preview.url); }, [take]);
    useEffect(() => () => stopRef.current(), []);

    const stopPlayback = () => stopRef.current();

    const playRange = (which: "new" | "current", url: string, start: number, end: number) => {
        stopPlayback();
        pauseMain();
        const el = (playerRef.current ??= new Audio());
        let raf = 0;
        const stop = () => {
            cancelAnimationFrame(raf);
            el.pause();
            setPlayingWhich(null);
        };
        const watch = () => {
            if (el.currentTime >= end || el.ended) return stop();
            raf = requestAnimationFrame(watch);
        };
        const begin = () => {
            el.currentTime = start;
            el.play().then(() => { setPlayingWhich(which); raf = requestAnimationFrame(watch); }).catch(stop);
        };
        stopRef.current = stop;
        if (el.src !== url) {
            el.src = url;
            el.addEventListener("loadedmetadata", begin, { once: true });
        } else begin();
    };

    // Play only the sentence being fixed/edited.
    const hear = (which: "new" | "current") => {
        if (playingWhich === which) return stopPlayback();
        const a = which === "new" ? take?.preview : audio;
        if (!a) return;
        playRange(which, a.url, a.starts[index], a.ends[index]);
    };

    const suggest = async () => {
        if (!selected) {
            toast.info("Select (or click into) the word that sounds wrong first.");
            return;
        }
        setSuggesting(true);
        setOptions(null);
        try {
            setOptions(await suggestSpellings(selected.word, wording));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't get suggestions.");
        } finally {
            setSuggesting(false);
        }
    };

    const applyOption = (option: SpellingOption) => {
        if (!selected) return;
        const next = text.slice(0, selected.start) + option.text + text.slice(selected.end);
        setText(next);
        setTake(null);
        setSelection({ start: selected.start, end: selected.start + option.text.length });
        setLibTerm(inferTerm(selected.word));
        setLibSpoken(option.text);
        setSaveToLibrary(true);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(selected.start, selected.start + option.text.length);
        });
    };

    const generate = async () => {
        if (!text.trim() || !wording.trim()) return;
        stopPlayback();
        setGenerating(true);
        try {
            const seed = Math.floor(Math.random() * 1_000_000_000);
            const sentences = buildCandidate(script.sentences, index, wording.trim(), text.trim(), seed);
            const pcm = await generateSentence(requestsFor(sentences)[index]);
            // Only this sentence changes; every other sentence keeps its exact samples.
            const preview = spliceSentence(audio, index, pcm, sentences);
            const id = crypto.randomUUID();
            setTake({ id, seed, sentences, preview });
            onTake({ takeId: id, seed, before: sentence, after: sentences[index] });
            playRange("new", preview.url, preview.starts[index], preview.ends[index]);
        } catch (err) {
            if (err instanceof AuthError) onAuthError();
            else toast.error(err instanceof Error ? err.message : "Generation failed.");
        } finally {
            setGenerating(false);
        }
    };

    const keep = async () => {
        if (!take) return;
        stopPlayback();
        setKeeping(true);
        try {
            const entry = saveToLibrary && libTerm.trim() && libSpoken.trim()
                ? { term: libTerm.trim(), spoken: libSpoken.trim() }
                : null;
            await onKeep(take.sentences, entry, { takeId: take.id, seed: take.seed, before: sentence, after: take.sentences[index] }, take.preview);
        } finally {
            setKeeping(false);
        }
    };

    // Prepared options for the names/acronyms in this sentence.
    const sentenceNouns = useMemo(
        () => (script.nouns ?? []).filter(n => wordRegex(n.term).test(wording)),
        [script.nouns, wording]
    );

    const applyNounOption = (noun: NounOptions, option: SpellingOption) => {
        const current = currentOption(noun, text);
        if (!current) {
            toast.info(`Couldn't find “${noun.term}” in the text — edit it directly.`);
            return;
        }
        if (current.text === option.text) return;
        setText(text.replace(wordRegex(current.text, "gu"), () => option.text));
        setTake(null);
        setLibTerm(noun.term);
        setLibSpoken(option.text);
        setSaveToLibrary(true);
    };

    const allOptions = [...libraryOptions, ...(options ?? [])].filter(
        (o, i, arr) => arr.findIndex(x => x.text === o.text) === i
    );

    return (
        <div className="mt-2 mb-3 ml-8 rounded-xl border border-indigo-500/30 bg-slate-900 p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
                {mode === "fix" ? (
                    <div className="text-sm">
                        <span className="text-xs uppercase tracking-wide text-slate-500 mr-2">Original</span>
                        <span className="text-slate-300">{sentence.original}</span>
                    </div>
                ) : (
                    <div className="flex-1 space-y-2">
                        <label className="text-xs uppercase tracking-wide text-slate-500" htmlFor={`edit-${index}`}>
                            Sentence text
                        </label>
                        <textarea
                            id={`edit-${index}`}
                            value={wording}
                            autoFocus
                            rows={3}
                            onChange={e => {
                                setWording(e.target.value);
                                setText(toSpoken(e.target.value, script.nouns ?? [], library, sentence.spoken));
                                setTake(null);
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none px-3 py-2 text-[15px] leading-relaxed resize-y"
                        />
                        <p className="text-xs text-slate-500">Name spellings and number readings below update automatically.</p>
                    </div>
                )}
                <Button size="icon-sm" variant="ghost" onClick={() => { stopPlayback(); onClose(); }} aria-label="Close panel">
                    <X />
                </Button>
            </div>

            <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-500" htmlFor={`fix-${index}`}>
                    Sent to ElevenLabs
                </label>
                <textarea
                    id={`fix-${index}`}
                    ref={textareaRef}
                    value={text}
                    autoFocus={mode === "fix"}
                    rows={2}
                    onChange={e => { setText(e.target.value); setTake(null); }}
                    onSelect={e => setSelection({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none px-3 py-2 text-[15px] leading-relaxed resize-y"
                />
                {sentenceNouns.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                        {sentenceNouns.map(noun => {
                            const current = currentOption(noun, text);
                            return (
                                <div key={noun.term} className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm text-slate-400 w-full sm:w-auto sm:min-w-28 sm:mr-1">{noun.term}</span>
                                    {noun.options.map(o => {
                                        const isCurrent = current?.text === o.text;
                                        return (
                                            <button
                                                key={o.text}
                                                onClick={() => applyNounOption(noun, o)}
                                                aria-pressed={isCurrent}
                                                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${isCurrent ? "border-indigo-400 bg-indigo-500/15 text-white" : "border-slate-700 hover:border-indigo-400 hover:bg-indigo-500/10"}`}
                                            >
                                                {o.text}
                                                <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">{isCurrent ? "current" : o.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" variant="ghost" onClick={suggest} disabled={suggesting || !selected} className="text-slate-400">
                        {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        {selected ? `Other word? Ask Claude about “${selected.word}”` : "Other word? Select it to ask Claude"}
                    </Button>
                    {allOptions.map(o => (
                        <button
                            key={o.text}
                            onClick={() => applyOption(o)}
                            disabled={!selected}
                            className="text-sm px-3 py-1.5 rounded-lg border border-slate-700 hover:border-indigo-400 hover:bg-indigo-500/10 disabled:opacity-40"
                        >
                            {o.text}
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-500">{o.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
                <Button size="sm" onClick={generate} disabled={generating || !text.trim() || !wording.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white mt-3">
                    {generating ? <Loader2 className="animate-spin" /> : <Wand2 />}
                    {take ? "Try another take" : "Generate new take"}
                </Button>
                {take && (
                    <>
                        <Button size="sm" variant="outline" className="mt-3" onClick={() => hear("new")}>
                            {playingWhich === "new" ? <Square /> : <Play />}Hear new
                        </Button>
                        <Button size="sm" variant="ghost" className="mt-3 text-slate-400" onClick={() => hear("current")}>
                            {playingWhich === "current" ? <Square /> : <Play />}Hear current
                        </Button>
                        <Button size="sm" onClick={keep} disabled={keeping} className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white ml-auto">
                            {keeping ? <Loader2 className="animate-spin" /> : <Check />}Keep new
                        </Button>
                    </>
                )}
            </div>

            {take && (
                <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                            type="checkbox"
                            checked={saveToLibrary}
                            onChange={e => setSaveToLibrary(e.target.checked)}
                            className="accent-indigo-500"
                        />
                        <BookPlus className="w-4 h-4 text-slate-400" />
                        Save to pronunciation library (applied to future sets)
                    </label>
                    {saveToLibrary && (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <input
                                value={libTerm}
                                onChange={e => setLibTerm(e.target.value)}
                                placeholder="As written in scripts, e.g. KIIT"
                                className="flex-1 min-w-40 rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5"
                            />
                            <span className="text-slate-500">→</span>
                            <input
                                value={libSpoken}
                                onChange={e => setLibSpoken(e.target.value)}
                                placeholder="Spelling to send, e.g. K I I T"
                                className="flex-1 min-w-40 rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5"
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
