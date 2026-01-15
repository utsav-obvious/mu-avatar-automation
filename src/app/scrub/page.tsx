"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { alignAudioToText } from "@/actions/scrub-actions";
import { WordAlignment } from "@/actions/audio-actions";
import { toast } from "sonner";
import { Loader2, Music, Play, Pause, FileText, Upload, ArrowLeft, RotateCcw, Volume2, FastForward, Rewind, Sparkles } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import Link from "next/link";

export default function ScrubPage() {
    const [script, setScript] = useState("");
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isAligning, setIsAligning] = useState(false);
    const [wordAlignments, setWordAlignments] = useState<WordAlignment[]>([]);
    const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        return () => {
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
        };
    }, [audioUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.type.startsWith("audio/")) {
                toast.error("Please upload an audio file.");
                return;
            }
            setAudioFile(file);
            const url = URL.createObjectURL(file);
            setAudioUrl(url);
            setWordAlignments([]);
            setCurrentWordIndex(null);
            setIsPlaying(false);
            if (audioRef.current) {
                audioRef.current.src = url;
            }
        }
    };

    const handleAlign = async () => {
        if (!audioFile || !script.trim()) {
            toast.error("Please upload an audio file and enter a script.");
            return;
        }

        setIsAligning(true);
        try {
            const formData = new FormData();
            formData.append("file", audioFile);
            formData.append("text", script);

            const alignments = await alignAudioToText(formData);
            setWordAlignments(alignments);
            toast.success("Alignment complete!");
        } catch (error) {
            toast.error("Failed to align audio and text.");
        } finally {
            setIsAligning(false);
        }
    };

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const skip10 = (forward: boolean) => {
        if (audioRef.current) {
            const newTime = audioRef.current.currentTime + (forward ? 10 : -10);
            audioRef.current.currentTime = Math.max(0, Math.min(newTime, duration));
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8 font-sans">
            <header className="max-w-4xl mx-auto mb-12 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/">
                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white hover:bg-slate-900 rounded-full">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight mb-1 flex items-center gap-3">
                            <Volume2 className="w-8 h-8 text-indigo-400" />
                            Audio Scrub Utility
                        </h1>
                        <p className="text-sm text-slate-400">Align existing audio with text for easy scrubbing</p>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto grid grid-cols-1 gap-8">
                {/* Input Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="bg-slate-900 border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                        <CardHeader className="pb-4 border-b border-slate-800/50">
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <Upload className="w-4 h-4 text-indigo-400" />
                                Audio File
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="space-y-4">
                                <div className="relative group">
                                    <input
                                        type="file"
                                        accept="audio/*"
                                        onChange={handleFileChange}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                    />
                                    <div className={`border-2 border-dashed rounded-2xl p-8 transition-all flex flex-col items-center justify-center gap-3 ${audioFile ? "border-indigo-500/50 bg-indigo-500/5" : "border-slate-800 hover:border-slate-700 bg-slate-950/50"}`}>
                                        <div className={`p-4 rounded-full ${audioFile ? "bg-indigo-500/20 text-indigo-400" : "bg-slate-900 text-slate-500"}`}>
                                            <Music className="w-8 h-8" />
                                        </div>
                                        <div className="text-center">
                                            <p className="font-medium text-slate-200">{audioFile ? audioFile.name : "Choose an audio file"}</p>
                                            <p className="text-xs text-slate-500 mt-1">MP3, WAV, or AAC</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900 border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                        <CardHeader className="pb-4 border-b border-slate-800/50">
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <FileText className="w-4 h-4 text-indigo-400" />
                                Script / Transcript
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <Textarea
                                placeholder="Paste the exact script spoken in the audio..."
                                className="min-h-[148px] bg-slate-950 border-slate-800 rounded-xl resize-none focus-visible:ring-indigo-500 text-sm p-4"
                                value={script}
                                onChange={(e) => setScript(e.target.value)}
                            />
                        </CardContent>
                    </Card>
                </div>

                <Button
                    onClick={handleAlign}
                    disabled={isAligning || !audioFile || !script.trim()}
                    className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl shadow-lg shadow-indigo-500/20 text-lg font-bold gap-3 transition-all active:scale-95"
                >
                    {isAligning ? (
                        <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            Aligning with ElevenLabs...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-6 h-6" />
                            Run Forced Alignment
                        </>
                    )}
                </Button>

                {/* Playback Section */}
                {audioUrl && (
                    <Card className={`bg-slate-900 border-slate-800 rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 animate-in fade-in zoom-in-95 ${wordAlignments.length > 0 ? "border-indigo-500/30" : ""}`}>
                        <CardContent className="p-8 space-y-8">
                            <audio
                                ref={audioRef}
                                src={audioUrl}
                                onTimeUpdate={() => {
                                    if (audioRef.current) {
                                        const time = audioRef.current.currentTime;
                                        setCurrentTime(time);
                                        if (wordAlignments.length > 0) {
                                            const idx = wordAlignments.findIndex(a => time >= a.start && time <= a.end);
                                            setCurrentWordIndex(idx !== -1 ? idx : null);
                                        }
                                    }
                                }}
                                onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
                                onEnded={() => setIsPlaying(false)}
                                hidden
                            />

                            {/* Word Transcript */}
                            {wordAlignments.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-2">
                                            <FileText className="w-3 h-3" />
                                            Interactive Transcript
                                        </label>
                                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Generated via ElevenLabs</span>
                                    </div>
                                    <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 text-xl leading-relaxed text-slate-400 flex flex-wrap gap-x-2 gap-y-1 max-h-[250px] overflow-y-auto custom-scrollbar shadow-inner">
                                        {wordAlignments.map((alignment, idx) => (
                                            <span
                                                key={idx}
                                                onClick={() => {
                                                    if (audioRef.current) {
                                                        audioRef.current.currentTime = alignment.start;
                                                        setCurrentTime(alignment.start);
                                                        if (!isPlaying) {
                                                            audioRef.current.play();
                                                            setIsPlaying(true);
                                                        }
                                                    }
                                                }}
                                                className={`cursor-pointer transition-all px-1 rounded hover:text-white hover:bg-slate-800 ${currentWordIndex === idx ? "text-indigo-400 bg-indigo-500/10 font-bold scale-110 ring-1 ring-indigo-500/20 shadow-[0_0_15px_-3px_rgba(99,102,241,0.3)]" : ""}`}
                                            >
                                                {alignment.word}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Player Controls */}
                            <div className="bg-slate-950 p-8 rounded-[2rem] border border-slate-800 shadow-inner space-y-8">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between text-xs font-bold font-mono text-slate-500 uppercase tracking-widest">
                                        <span>{formatTime(currentTime)}</span>
                                        <span>{formatTime(duration)}</span>
                                    </div>
                                    <Slider
                                        value={[currentTime]}
                                        max={duration}
                                        step={0.01}
                                        onValueChange={([val]) => {
                                            if (audioRef.current) {
                                                audioRef.current.currentTime = val;
                                                setCurrentTime(val);
                                            }
                                        }}
                                        className="py-4"
                                    />
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-8">
                                    <div className="flex items-center gap-4">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-12 w-12 rounded-full border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                                            onClick={() => skip10(false)}
                                        >
                                            <Rewind className="w-5 h-5 fill-current" />
                                        </Button>

                                        <Button
                                            onClick={togglePlay}
                                            className={`h-20 w-20 rounded-full flex items-center justify-center transition-all shadow-xl hover:scale-105 active:scale-95 ${isPlaying
                                                ? "bg-red-500/10 border border-red-500/50 text-red-400 hover:bg-red-500/20"
                                                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/30"
                                                }`}
                                        >
                                            {isPlaying ? (
                                                <Pause className="w-8 h-8 fill-current" />
                                            ) : (
                                                <Play className="w-8 h-8 fill-current ml-1" />
                                            )}
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-12 w-12 rounded-full border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                                            onClick={() => skip10(true)}
                                        >
                                            <FastForward className="w-5 h-5 fill-current" />
                                        </Button>
                                    </div>

                                    <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 p-2 rounded-2xl">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={`px-3 h-10 rounded-xl text-xs font-bold transition-all ${playbackRate === 0.5 ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/50" : "text-slate-500 hover:text-slate-300"}`}
                                            onClick={() => {
                                                setPlaybackRate(0.5);
                                                if (audioRef.current) audioRef.current.playbackRate = 0.5;
                                            }}
                                        >
                                            0.5x
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={`px-3 h-10 rounded-xl text-xs font-bold transition-all ${playbackRate === 1 ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/50" : "text-slate-500 hover:text-slate-300"}`}
                                            onClick={() => {
                                                setPlaybackRate(1);
                                                if (audioRef.current) audioRef.current.playbackRate = 1;
                                            }}
                                        >
                                            1.0x
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={`px-3 h-10 rounded-xl text-xs font-bold transition-all ${playbackRate === 1.5 ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/50" : "text-slate-500 hover:text-slate-300"}`}
                                            onClick={() => {
                                                setPlaybackRate(1.5);
                                                if (audioRef.current) audioRef.current.playbackRate = 1.5;
                                            }}
                                        >
                                            1.5x
                                        </Button>
                                    </div>

                                    <Button
                                        variant="outline"
                                        className="border-slate-800 text-slate-400 hover:text-white rounded-xl h-12 gap-2"
                                        onClick={() => {
                                            setAudioFile(null);
                                            setAudioUrl(null);
                                            setScript("");
                                            setWordAlignments([]);
                                        }}
                                    >
                                        <RotateCcw className="w-4 h-4" />
                                        Clear All
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}
