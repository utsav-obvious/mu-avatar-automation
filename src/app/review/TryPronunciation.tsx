"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play, Square, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthError, generateSentence, joinSentences } from "./audio";

// Quick pronunciation check: type a word or short phrase and hear just that, without generating a
// whole sentence. Each try costs only its own characters; repeats come from the browser cache.
const MAX_TRIES = 8;
const MAX_CHARS = 120;

interface Try {
    text: string;
    url: string;
}

export default function TryPronunciation({ pauseMain, onAuthError }: { pauseMain: () => void; onAuthError: () => void }) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [tries, setTries] = useState<Try[]>([]);
    const [playing, setPlaying] = useState<string | null>(null);
    const playerRef = useRef<HTMLAudioElement | null>(null);
    const triesRef = useRef(tries);
    triesRef.current = tries;

    // Free every blob URL when the page goes away.
    useEffect(() => () => triesRef.current.forEach(t => URL.revokeObjectURL(t.url)), []);

    const play = (t: Try) => {
        const el = (playerRef.current ??= new Audio());
        if (playing === t.url && !el.paused) {
            el.pause();
            setPlaying(null);
            return;
        }
        pauseMain();
        el.src = t.url;
        el.onended = () => setPlaying(null);
        el.play().then(() => setPlaying(t.url)).catch(() => setPlaying(null));
    };

    const generate = async () => {
        const value = text.trim();
        if (!value || busy) return;
        const existing = tries.find(t => t.text === value);
        if (existing) return play(existing);
        setBusy(true);
        try {
            const pcm = await generateSentence({ text: value, seed: 42 });
            const { url } = joinSentences([pcm], [{ original: value, spoken: value, paragraph: 0, seed: 42 }]);
            const entry = { text: value, url };
            setTries(prev => {
                const next = [entry, ...prev];
                next.slice(MAX_TRIES).forEach(t => URL.revokeObjectURL(t.url));
                return next.slice(0, MAX_TRIES);
            });
            play(entry);
        } catch (err) {
            if (err instanceof AuthError) onAuthError();
            else toast.error(err instanceof Error ? err.message : "Couldn't generate that.");
        } finally {
            setBusy(false);
        }
    };

    const remove = (t: Try) => {
        if (playing === t.url) playerRef.current?.pause();
        URL.revokeObjectURL(t.url);
        setTries(prev => prev.filter(x => x !== t));
    };

    return (
        <div className="flex flex-wrap items-center gap-2 min-w-0">
            <form
                onSubmit={e => { e.preventDefault(); void generate(); }}
                className="flex items-center gap-1.5"
            >
                <Volume2 className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                <input
                    value={text}
                    onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
                    placeholder="Try a pronunciation, e.g. गौरव or Gow-rav"
                    aria-label="Word or phrase to hear"
                    className="w-56 sm:w-72 h-8 rounded-md bg-slate-900 border border-slate-700 focus:border-indigo-500 outline-none px-2.5 text-sm"
                />
                <Button type="submit" size="sm" disabled={busy || !text.trim()} className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white">
                    {busy ? <Loader2 className="animate-spin" /> : <Play />}Hear
                </Button>
            </form>
            {tries.map(t => (
                <span key={t.url} className="inline-flex items-center rounded-md border border-slate-700 text-sm overflow-hidden">
                    <button
                        onClick={() => play(t)}
                        onDoubleClick={() => setText(t.text)}
                        title="Play again · double-click to edit"
                        className={`flex items-center gap-1 pl-2 pr-1.5 py-1 hover:bg-slate-800 ${playing === t.url ? "text-indigo-300" : "text-slate-300"}`}
                    >
                        {playing === t.url ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        <span className="max-w-40 truncate">{t.text}</span>
                    </button>
                    <button onClick={() => remove(t)} aria-label={`Remove ${t.text}`} className="px-1 py-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800">
                        <X className="w-3 h-3" />
                    </button>
                </span>
            ))}
        </div>
    );
}
