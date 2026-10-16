"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, CircleDot, Download, Loader2, Pause, Pencil, Play, RotateCcw, Trash2, Type, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChangeLogEntry, LibraryEntry, ReviewScript, ReviewSet, ScriptStatus, Sentence } from "@/lib/review/types";
import { logChanges, markInReview, saveLibraryEntry, saveSentences, setScriptStatus } from "./actions";
import { AuthError, isLoaded, loadScriptAudio, requestsFor, type ScriptAudio } from "./audio";
import FixPanel, { type TakeInfo } from "./FixPanel";

const SPEEDS = [1, 1.25, 1.5];
// Preparing the next script in the background spends credits before anyone opens it.
// Off until the tool is final; flip to true to re-enable.
const PREFETCH_NEXT_SCRIPT = false;

const STATUS_STYLE: Record<ScriptStatus, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-slate-800 text-slate-400 border-slate-700" },
    in_review: { label: "In review", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
    approved: { label: "Approved", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
};

function StatusBadge({ status }: { status: ScriptStatus }) {
    const s = STATUS_STYLE[status];
    return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.className}`}>{s.label}</span>;
}

// e.g. "C8-R1-Set1_MUSB-C8-71478_Utkarsh-Verma.wav"
function downloadName(set: ReviewSet | undefined, script: ReviewScript): string {
    const slug = (s: string) => s.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
    const name = script.student_name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return `${[set?.file_prefix, script.application_number, name].filter(Boolean).map(p => slug(p!)).join("_")}.wav`;
}

function saveFile(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// Reviewer name: asked once per browser, attached to every change-log row. Kept in localStorage,
// with an in-memory fallback when storage is blocked.
const REVIEWER_KEY = "review-reviewer-name";
let reviewerFallback = "";
const reviewerListeners = new Set<() => void>();
function readReviewer(): string {
    try {
        return localStorage.getItem(REVIEWER_KEY) ?? reviewerFallback;
    } catch {
        return reviewerFallback;
    }
}
function writeReviewer(name: string) {
    reviewerFallback = name;
    try {
        localStorage.setItem(REVIEWER_KEY, name);
    } catch {
        // storage blocked — the in-memory value lasts for this tab
    }
    reviewerListeners.forEach(l => l());
}
function subscribeReviewer(listener: () => void) {
    reviewerListeners.add(listener);
    return () => { reviewerListeners.delete(listener); };
}

const formatTime = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;

export default function ReviewApp({
    sets,
    scripts,
    library: initialLibrary,
    initialSetId,
    initialScriptId,
}: {
    sets: ReviewSet[];
    scripts: ReviewScript[];
    library: LibraryEntry[];
    initialSetId?: string;
    initialScriptId?: string;
}) {
    const router = useRouter();
    const initialScript = scripts.find(s => s.id === initialScriptId);

    const [activeSetId, setActiveSetId] = useState(initialScript?.set_id ?? (sets.some(s => s.id === initialSetId) ? initialSetId : sets[0]?.id));
    const [activeScriptId, setActiveScriptId] = useState(initialScript?.id);
    const [statuses, setStatuses] = useState<Record<string, ScriptStatus>>(() => Object.fromEntries(scripts.map(s => [s.id, s.status])));
    const [ready, setReady] = useState<Set<string>>(() => new Set());
    const [edits, setEdits] = useState<Record<string, Sentence[]>>({}); // fixes saved this session
    const [library, setLibrary] = useState(initialLibrary);
    const [fixIndex, setFixIndex] = useState<number | null>(null);
    const [fixMode, setFixMode] = useState<"fix" | "edit">("fix");
    const [audioUnlocked, setAudioUnlocked] = useState<string | null>(null); // approved script allowed to load audio
    const pendingDownloadRef = useRef<string | null>(null);
    const reviewer = useSyncExternalStore(subscribeReviewer, readReviewer, () => null); // null until hydrated
    const [nameDraft, setNameDraft] = useState("");

    const [audio, setAudio] = useState<ScriptAudio | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [rate, setRate] = useState(1);

    const audioRef = useRef<HTMLAudioElement>(null);
    const sentenceRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const autoplayRef = useRef(false);
    const resumeAtRef = useRef<number | null>(null); // sentence to seek to once rebuilt audio loads

    const allScripts = useMemo(
        () => scripts.map(s => (edits[s.id] ? { ...s, sentences: edits[s.id] } : s)),
        [scripts, edits]
    );
    const setScripts = useMemo(() => allScripts.filter(s => s.set_id === activeSetId), [allScripts, activeSetId]);
    const activeScript = allScripts.find(s => s.id === activeScriptId);

    const currentIdx = useMemo(() => {
        if (!audio) return null;
        let idx = 0;
        audio.starts.forEach((start, i) => { if (currentTime + 0.01 >= start) idx = i; });
        return idx;
    }, [audio, currentTime]);

    // Keep the URL shareable: /review?set=…&script=…
    useEffect(() => {
        const params = new URLSearchParams();
        if (activeSetId) params.set("set", activeSetId);
        if (activeScriptId) params.set("script", activeScriptId);
        window.history.replaceState(null, "", `/review?${params}`);
    }, [activeSetId, activeScriptId]);

    const handleAuthError = useCallback(() => {
        toast.error("Session expired — enter the passcode again.");
        router.refresh();
    }, [router]);

    // Approved scripts don't generate audio unless the reviewer asks (Download again / Reopen).
    const shouldLoad = !!activeScript && (statuses[activeScript.id] !== "approved" || audioUnlocked === activeScript.id);

    // Generate (or fetch from cache) the active script's audio, then (optionally) prepare the next script.
    useEffect(() => {
        if (!activeScript || !shouldLoad) return;
        let cancelled = false;
        loadScriptAudio(activeScript, (done, total) => { if (!cancelled) setProgress({ done, total }); })
            .then(result => {
                if (cancelled) return;
                setAudio(result);
                setReady(prev => new Set(prev).add(activeScript.id));
                if (pendingDownloadRef.current === activeScript.id) {
                    pendingDownloadRef.current = null;
                    saveFile(result.url, downloadName(sets.find(s => s.id === activeScript.set_id), activeScript));
                }
                if (!PREFETCH_NEXT_SCRIPT) return;
                const siblings = allScripts.filter(s => s.set_id === activeScript.set_id);
                const next = siblings.slice(siblings.indexOf(activeScript) + 1).find(s => statuses[s.id] !== "approved" && !isLoaded(s));
                if (next) {
                    loadScriptAudio(next)
                        .then(() => setReady(prev => new Set(prev).add(next.id)))
                        .catch(() => {});
                }
            })
            .catch(err => {
                if (cancelled) return;
                if (err instanceof AuthError) handleAuthError();
                else setError(err instanceof Error ? err.message : "Audio generation failed.");
            });
        return () => { cancelled = true; };
        // statuses is read for prefetch only; re-running on status changes would reset playback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeScript, shouldLoad, retryKey, allScripts, handleAuthError]);

    // Smooth highlight while playing.
    useEffect(() => {
        if (!playing) return;
        let raf = 0;
        const tick = () => {
            if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing]);

    useEffect(() => {
        if (playing && currentIdx !== null) sentenceRefs.current[currentIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [currentIdx, playing]);

    const openScript = (script: ReviewScript) => {
        if (script.id === activeScriptId) return;
        audioRef.current?.pause();
        setActiveScriptId(script.id);
        setFixIndex(null);
        setAudio(null);
        setError(null);
        setProgress(null);
        setCurrentTime(0);
        setAudioUnlocked(null);
        autoplayRef.current = statuses[script.id] !== "approved";
        if (statuses[script.id] === "pending") {
            markInReview(script.id)
                .then(status => setStatuses(prev => ({ ...prev, [script.id]: status })))
                .catch(() => toast.error("Couldn't update the script status."));
        }
    };

    const openSet = (setId: string) => {
        if (setId === activeSetId) return;
        audioRef.current?.pause();
        setActiveSetId(setId);
        setActiveScriptId(undefined);
        setAudioUnlocked(null);
        setFixIndex(null);
        setAudio(null);
        setError(null);
        setProgress(null);
    };

    const retry = () => {
        setError(null);
        setProgress(null);
        setRetryKey(k => k + 1);
    };

    const togglePlay = useCallback(() => {
        const el = audioRef.current;
        if (!el || !audio) return;
        if (el.paused) el.play().catch(() => {});
        else el.pause();
    }, [audio]);

    const playSentence = useCallback((i: number) => {
        const el = audioRef.current;
        if (!el || !audio) return;
        const idx = Math.max(0, Math.min(i, audio.starts.length - 1));
        el.currentTime = audio.starts[idx];
        setCurrentTime(audio.starts[idx]);
        el.play().catch(() => {});
    }, [audio]);

    const changeRate = (r: number) => {
        setRate(r);
        if (audioRef.current) audioRef.current.playbackRate = r;
    };

    const openFix = useCallback((i: number, mode: "fix" | "edit" = "fix") => {
        audioRef.current?.pause();
        setFixIndex(i);
        setFixMode(mode);
    }, []);

    // Saves a script's new sentence list. The audio effect then rebuilds it from cache — only a
    // changed sentence is ever new; neighbours keep their exact takes via frozen context.
    const commitSentences = async (
        script: ReviewScript,
        sentences: Sentence[],
        opts: { message: string; resumeAt: number; undo?: Sentence[]; onUndone?: () => void }
    ): Promise<boolean> => {
        try {
            await saveSentences(script.id, sentences);
        } catch {
            toast.error("Couldn't save the change — try again.");
            return false;
        }
        resumeAtRef.current = opts.resumeAt;
        setEdits(prev => ({ ...prev, [script.id]: sentences }));
        setFixIndex(null);
        const undo = opts.undo;
        toast.success(opts.message, undo && {
            duration: 10_000,
            action: {
                label: "Undo",
                onClick: () => {
                    void commitSentences(script, undo, { message: "Restored", resumeAt: opts.resumeAt })
                        .then(ok => { if (ok) opts.onUndone?.(); });
                },
            },
        });
        if (statuses[script.id] === "approved") {
            // The downloaded file no longer matches — require a fresh approval.
            setScriptStatus(script.id, "in_review")
                .then(() => {
                    setStatuses(prev => ({ ...prev, [script.id]: "in_review" }));
                    toast.info("Script reopened — approve again to download the updated file.");
                })
                .catch(() => toast.error("Couldn't reopen the script."));
        }
        return true;
    };

    // Fire-and-forget: logging must never get in the reviewer's way.
    const logChange = (script: ReviewScript, entries: Omit<ChangeLogEntry, "set_id" | "set_name" | "script_id" | "application_number" | "reviewer">[]) => {
        const set = sets.find(s => s.id === script.set_id);
        logChanges(entries.map(e => ({
            set_id: script.set_id,
            set_name: set?.name ?? "",
            script_id: script.id,
            application_number: script.application_number,
            reviewer: reviewer || "unknown",
            ...e,
        }))).catch(err => console.warn("Change log failed:", err));
    };

    const logTake = (take: TakeInfo) => {
        if (!activeScript || fixIndex === null) return;
        logChange(activeScript, [{
            action: "take",
            sentence_index: fixIndex,
            before_original: take.before.original,
            before_spoken: take.before.spoken,
            after_original: take.after.original,
            after_spoken: take.after.spoken,
            take_id: take.takeId,
            seed: take.seed,
        }]);
    };

    const keepFix = async (sentences: Sentence[], entry: LibraryEntry | null, take: TakeInfo) => {
        if (!activeScript || fixIndex === null) return;
        const message = fixMode === "edit" ? "Sentence updated" : "Fix saved";
        const index = fixIndex;
        const saved = await commitSentences(activeScript, sentences, {
            message: entry ? `${message} · “${entry.term}” added to library` : message,
            resumeAt: Math.max(0, index - 1),
        });
        if (saved) {
            logChange(activeScript, [{
                action: fixMode,
                sentence_index: index,
                before_original: take.before.original,
                before_spoken: take.before.spoken,
                after_original: take.after.original,
                after_spoken: take.after.spoken,
                take_id: take.takeId,
                seed: take.seed,
                library_term: entry?.term ?? null,
                library_spoken: entry?.spoken ?? null,
            }]);
        }
        if (saved && entry) {
            try {
                await saveLibraryEntry({ ...entry, scriptId: activeScript.id });
                setLibrary(prev => [...prev.filter(e => e.term !== entry.term), entry]);
            } catch {
                toast.error("Change saved, but the library entry couldn't be saved.");
            }
        }
    };

    // Neighbours keep the context their audio was generated with, so nothing is regenerated.
    const deleteSentence = async (i: number) => {
        if (!activeScript) return;
        const before = activeScript.sentences;
        if (before.length <= 1) {
            toast.error("A script needs at least one sentence.");
            return;
        }
        audioRef.current?.pause();
        const old = requestsFor(before);
        const after = before.flatMap((s, k) => {
            if (k === i) return [];
            if (k === i - 1) return [{ ...s, next_context: old[k].nextText }];
            if (k === i + 1) return [{ ...s, prev_context: old[k].previousText }];
            return [s];
        });
        const script = activeScript;
        const removed = before[i];
        const saved = await commitSentences(script, after, {
            message: `Sentence ${i + 1} deleted`,
            resumeAt: Math.max(0, i - 1),
            undo: before,
            onUndone: () => logChange(script, [{
                action: "undo",
                sentence_index: i,
                after_original: removed.original,
                after_spoken: removed.spoken,
            }]),
        });
        if (saved) {
            logChange(script, [{
                action: "delete",
                sentence_index: i,
                before_original: removed.original,
                before_spoken: removed.spoken,
            }]);
        }
    };

    const [statusBusy, setStatusBusy] = useState(false);

    const nextUnapproved = activeScript
        ? setScripts.slice(setScripts.indexOf(activeScript) + 1).concat(setScripts.slice(0, setScripts.indexOf(activeScript)))
            .find(s => statuses[s.id] !== "approved")
        : undefined;

    const approve = async () => {
        if (!activeScript || !audio) return;
        const script = activeScript;
        saveFile(audio.url, downloadName(sets.find(s => s.id === script.set_id), script));
        setStatusBusy(true);
        try {
            await setScriptStatus(script.id, "approved");
            setStatuses(prev => ({ ...prev, [script.id]: "approved" }));
            toast.success(`${script.student_name} approved and downloaded`);
        } catch {
            toast.error("Downloaded, but couldn't mark the script approved — try again.");
        } finally {
            setStatusBusy(false);
        }
    };

    const reopen = async () => {
        if (!activeScript) return;
        const id = activeScript.id;
        setStatusBusy(true);
        try {
            await setScriptStatus(id, "in_review");
            if (!audio) autoplayRef.current = true; // audio starts generating now that it's back in review
            setStatuses(prev => ({ ...prev, [id]: "in_review" }));
        } catch {
            toast.error("Couldn't reopen the script.");
        } finally {
            setStatusBusy(false);
        }
    };

    // Keyboard: space = play/pause, ↑/↓ = previous/next sentence, F = fix current sentence.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest("input, textarea, [contenteditable=true]")) return;
            if (e.code === "Space") { e.preventDefault(); togglePlay(); }
            else if (e.key === "ArrowDown" && currentIdx !== null) { e.preventDefault(); playSentence(currentIdx + 1); }
            else if (e.key === "ArrowUp" && currentIdx !== null) { e.preventDefault(); playSentence(currentIdx - 1); }
            else if ((e.key === "f" || e.key === "F") && currentIdx !== null && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openFix(currentIdx, "fix"); }
            else if ((e.key === "e" || e.key === "E") && currentIdx !== null && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openFix(currentIdx, "edit"); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [togglePlay, playSentence, openFix, currentIdx]);

    const approvedCount = (setId: string) => allScripts.filter(s => s.set_id === setId && statuses[s.id] === "approved").length;

    return (
        <div className="h-screen flex flex-col bg-slate-950 text-slate-50">
            <header className="shrink-0 border-b border-slate-800">
                <div className="px-4 lg:px-6 pt-4 flex items-baseline gap-3">
                    <h1 className="text-lg font-semibold">Script Review</h1>
                    <span className="text-sm text-slate-500">Founder-message audio · ElevenLabs Multilingual v2</span>
                    {reviewer && (
                        <span className="ml-auto text-sm text-slate-500">
                            Reviewing as <span className="text-slate-300">{reviewer}</span>
                            <button onClick={() => { setNameDraft(reviewer); writeReviewer(""); }} className="ml-2 text-indigo-400 hover:text-indigo-300">change</button>
                        </span>
                    )}
                </div>
                <nav className="px-4 lg:px-6 flex gap-1 overflow-x-auto mt-3" aria-label="Sets">
                    {sets.map(set => {
                        const total = allScripts.filter(s => s.set_id === set.id).length;
                        const active = set.id === activeSetId;
                        return (
                            <button
                                key={set.id}
                                onClick={() => openSet(set.id)}
                                className={`shrink-0 px-4 py-2.5 text-sm border-b-2 transition-colors ${active ? "border-indigo-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                            >
                                {set.name}
                                <span className="ml-2 text-xs text-slate-500">{approvedCount(set.id)}/{total}</span>
                            </button>
                        );
                    })}
                    {sets.length === 0 && <span className="py-2.5 text-sm text-slate-500">No sets uploaded yet.</span>}
                </nav>
            </header>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                <aside className="shrink-0 max-h-56 lg:max-h-none lg:w-[300px] overflow-y-auto custom-scrollbar border-b lg:border-b-0 lg:border-r border-slate-800">
                    <ul className="p-2 space-y-1">
                        {setScripts.map(script => {
                            const active = script.id === activeScriptId;
                            return (
                                <li key={script.id}>
                                    <button
                                        onClick={() => openScript(script)}
                                        className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${active ? "bg-indigo-500/15 ring-1 ring-indigo-500/40" : "hover:bg-slate-900"}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium truncate">{script.student_name}</span>
                                            <StatusBadge status={statuses[script.id]} />
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-500 mt-0.5">
                                            <span>{script.application_number}</span>
                                            {ready.has(script.id) && !active && (
                                                <span className="flex items-center gap-1 text-indigo-300/80"><CircleDot className="w-3 h-3" />audio ready</span>
                                            )}
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </aside>

                <main className="flex-1 min-h-0 min-w-0 overflow-y-auto custom-scrollbar">
                    {!activeScript ? (
                        <div className="h-[60vh] flex items-center justify-center text-slate-500 text-sm px-4 text-center">
                            Pick a script on the left — its audio is generated when you open it.
                        </div>
                    ) : (
                        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-6">
                            <div className="flex flex-wrap items-center gap-3 mb-5">
                                <h2 className="text-2xl font-semibold">{activeScript.student_name}</h2>
                                <StatusBadge status={statuses[activeScript.id]} />
                                <span className="text-sm text-slate-500">{activeScript.application_number}</span>
                                <div className="flex flex-wrap items-center gap-2 ml-auto">
                                    {statuses[activeScript.id] === "approved" ? (
                                        <>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!audio && shouldLoad && !error}
                                                onClick={() => {
                                                    if (audio) {
                                                        saveFile(audio.url, downloadName(sets.find(s => s.id === activeScript.set_id), activeScript));
                                                    } else {
                                                        pendingDownloadRef.current = activeScript.id;
                                                        setAudioUnlocked(activeScript.id);
                                                    }
                                                }}
                                            >
                                                {!audio && shouldLoad && !error ? <Loader2 className="animate-spin" /> : <Download />}Download again
                                            </Button>
                                            <Button size="sm" variant="ghost" disabled={statusBusy} onClick={reopen} className="text-slate-400">
                                                <Undo2 />Reopen
                                            </Button>
                                            {nextUnapproved && (
                                                <Button size="sm" onClick={() => openScript(nextUnapproved)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                                                    Next script<ArrowRight />
                                                </Button>
                                            )}
                                        </>
                                    ) : (
                                        <Button
                                            size="sm"
                                            disabled={!audio || statusBusy || fixIndex !== null}
                                            onClick={approve}
                                            title={fixIndex !== null ? "Close the open panel first" : undefined}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                        >
                                            {statusBusy ? <Loader2 className="animate-spin" /> : <Check />}Approve &amp; download
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Player */}
                            <div className="sticky top-3 z-10 bg-slate-900/95 backdrop-blur border border-slate-800 rounded-2xl p-4 mb-6">
                                {error ? (
                                    <div className="flex items-center gap-3 text-red-400 text-sm">
                                        <AlertCircle className="w-5 h-5 shrink-0" />
                                        <span className="flex-1">{error}</span>
                                        <Button size="sm" variant="outline" onClick={retry}><RotateCcw className="w-4 h-4" />Retry</Button>
                                    </div>
                                ) : !audio && !shouldLoad ? (
                                    <div className="flex flex-wrap items-center gap-3 text-sm">
                                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                        <span className="flex-1 text-slate-300">
                                            Approved — audio isn&apos;t generated for approved scripts. Reopen to review it again,
                                            or use <span className="text-slate-100">Download again</span> to re-create the file.
                                        </span>
                                        <Button size="sm" variant="outline" disabled={statusBusy} onClick={reopen}>
                                            <Undo2 />Reopen
                                        </Button>
                                    </div>
                                ) : !audio ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm text-slate-400">
                                            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                                            Preparing audio… {progress ? `${progress.done}/${progress.total} sentences` : ""}
                                        </div>
                                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-500 transition-all"
                                                style={{ width: `${progress ? (100 * progress.done) / progress.total : 0}%` }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <Button size="icon-lg" onClick={togglePlay} className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shrink-0" aria-label={playing ? "Pause" : "Play"}>
                                            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                                        </Button>
                                        <Button size="icon-sm" variant="ghost" onClick={() => playSentence((currentIdx ?? 0) - 1)} aria-label="Previous sentence"><ChevronUp /></Button>
                                        <Button size="icon-sm" variant="ghost" onClick={() => playSentence((currentIdx ?? 0) + 1)} aria-label="Next sentence"><ChevronDown /></Button>
                                        <span className="text-xs tabular-nums text-slate-400 w-20 text-center shrink-0">
                                            {formatTime(currentTime)} / {formatTime(audio.duration)}
                                        </span>
                                        <input
                                            type="range"
                                            min={0}
                                            max={audio.duration}
                                            step={0.01}
                                            value={currentTime}
                                            onChange={e => {
                                                const t = Number(e.target.value);
                                                if (audioRef.current) audioRef.current.currentTime = t;
                                                setCurrentTime(t);
                                            }}
                                            className="flex-1 min-w-0 accent-indigo-500"
                                            aria-label="Seek"
                                        />
                                        <div className="hidden sm:flex gap-1 shrink-0">
                                            {SPEEDS.map(s => (
                                                <button
                                                    key={s}
                                                    onClick={() => changeRate(s)}
                                                    className={`text-xs px-2 py-1 rounded-md border ${rate === s ? "border-indigo-500 bg-indigo-500/15 text-indigo-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
                                                >
                                                    {s}×
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Sentences */}
                            <ol className="space-y-1">
                                {activeScript.sentences.map((sentence, i) => {
                                    const current = audio !== null && currentIdx === i;
                                    const newParagraph = i > 0 && sentence.paragraph !== activeScript.sentences[i - 1].paragraph;
                                    return (
                                        <li key={i} className={newParagraph ? "pt-4" : ""}>
                                            <div className={`group flex items-start rounded-xl border-l-2 transition-colors ${current ? "bg-indigo-500/10 border-indigo-400" : "border-transparent hover:bg-slate-900"}`}>
                                                <button
                                                    ref={el => { sentenceRefs.current[i] = el; }}
                                                    onClick={() => playSentence(i)}
                                                    disabled={!audio}
                                                    className="flex-1 min-w-0 text-left px-4 py-3 disabled:cursor-default"
                                                >
                                                    <div className="flex gap-3">
                                                        <span className={`text-xs tabular-nums pt-1 w-5 shrink-0 ${current ? "text-indigo-300" : "text-slate-600"}`}>{i + 1}</span>
                                                        <div className="min-w-0">
                                                            <p className={`leading-relaxed ${current ? "text-white" : "text-slate-300"}`}>{sentence.original}</p>
                                                            {sentence.spoken !== sentence.original && (
                                                                <p className="text-xs text-slate-500 mt-1">
                                                                    <span className="uppercase tracking-wide mr-1.5">Sent as</span>{sentence.spoken}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>
                                                <div className={`flex items-center gap-0.5 mt-2 mr-2 shrink-0 ${fixIndex === i || current ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        disabled={!audio}
                                                        onClick={() => (fixIndex === i && fixMode === "fix" ? setFixIndex(null) : openFix(i, "fix"))}
                                                        className="text-slate-400 hover:text-white"
                                                        title="Fix pronunciation (F)"
                                                    >
                                                        <Pencil />Fix
                                                    </Button>
                                                    <Button
                                                        size="icon-sm"
                                                        variant="ghost"
                                                        disabled={!audio}
                                                        onClick={() => (fixIndex === i && fixMode === "edit" ? setFixIndex(null) : openFix(i, "edit"))}
                                                        className="text-slate-400 hover:text-white"
                                                        title="Edit sentence text (E)"
                                                        aria-label="Edit sentence text"
                                                    >
                                                        <Type />
                                                    </Button>
                                                    <Button
                                                        size="icon-sm"
                                                        variant="ghost"
                                                        disabled={!audio || activeScript.sentences.length <= 1}
                                                        onClick={() => deleteSentence(i)}
                                                        className="text-slate-400 hover:text-red-400"
                                                        title="Delete sentence"
                                                        aria-label="Delete sentence"
                                                    >
                                                        <Trash2 />
                                                    </Button>
                                                </div>
                                            </div>
                                            {fixIndex === i && audio && (
                                                <FixPanel
                                                    key={`${activeScript.id}-${i}-${fixMode}`}
                                                    mode={fixMode}
                                                    script={activeScript}
                                                    index={i}
                                                    audio={audio}
                                                    library={library}
                                                    pauseMain={() => audioRef.current?.pause()}
                                                    onTake={logTake}
                                                    onKeep={keepFix}
                                                    onClose={() => setFixIndex(null)}
                                                    onAuthError={handleAuthError}
                                                />
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>

                            <p className="text-xs text-slate-600 mt-6 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Space play/pause · ↑ ↓ previous/next sentence · F fix · E edit the current sentence · click a sentence to play from there
                            </p>
                        </div>
                    )}
                </main>
            </div>

            {reviewer === "" && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <form
                        onSubmit={e => { e.preventDefault(); if (nameDraft.trim()) writeReviewer(nameDraft.trim()); }}
                        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
                    >
                        <div>
                            <h2 className="text-lg font-semibold">What&apos;s your name?</h2>
                            <p className="text-sm text-slate-400 mt-1">It&apos;s saved with your fixes and edits so we can learn from them. Asked once per browser.</p>
                        </div>
                        <input
                            autoFocus
                            value={nameDraft}
                            onChange={e => setNameDraft(e.target.value)}
                            placeholder="e.g. Priya"
                            maxLength={100}
                            className="w-full h-11 rounded-lg bg-slate-950 border border-slate-700 focus:border-indigo-500 outline-none px-3"
                        />
                        <Button type="submit" disabled={!nameDraft.trim()} className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white">
                            Continue
                        </Button>
                    </form>
                </div>
            )}

            <audio
                ref={audioRef}
                src={audio?.url}
                preload="auto"
                onLoadedMetadata={e => { e.currentTarget.playbackRate = rate; }}
                onCanPlay={e => {
                    if (resumeAtRef.current !== null && audio) {
                        e.currentTarget.currentTime = audio.starts[Math.min(resumeAtRef.current, audio.starts.length - 1)];
                        setCurrentTime(e.currentTarget.currentTime);
                        resumeAtRef.current = null;
                    }
                    if (!autoplayRef.current) return;
                    autoplayRef.current = false;
                    e.currentTarget.play().catch(() => {});
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
                onEnded={() => setPlaying(false)}
                onSeeked={e => setCurrentTime(e.currentTarget.currentTime)}
                className="hidden"
            />
        </div>
    );
}
